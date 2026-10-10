import 'server-only'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { config } from '@/server/config'
import { AppError } from '@/server/errors'
import { recordQuery } from '@/server/query/history'
import {
    TransactionEscapedError,
    withTargetTransaction,
    type TxContext,
} from '@/server/query/session'
import { toJsonRows, typeNames } from '@/server/query/values'
import { assertWithinQuota, projectTarget } from '@/server/targets/connections'
import { isTransactionControl, splitStatements, type SqlStatement } from '@/shared/sql/split'

// Runs SQL from the editor against a project's database.
//
// Read mode (the default) uses the project's read-only role inside a READ
// ONLY transaction, so the database itself refuses writes; DataForge does not
// try to guess what a statement does from its text. Write mode uses the
// owner role, runs the whole script in one transaction and commits only if
// every statement succeeds.

export const runSchema = z.object({
    sql: z
        .string()
        .min(1, 'Write a query first.')
        .max(100_000, 'Scripts are limited to 100,000 characters.'),
    mode: z.enum(['read', 'write']).default('read'),
    runId: z.uuid().optional(),
    maxRows: z.number().int().min(1).max(10_000).optional(),
})

export interface ResultField {
    name: string
    type: string
}

export interface StatementResult {
    index: number
    sql: string
    command: string | null
    rowCount: number | null
    fields: ResultField[]
    rows: unknown[][]
    truncated: boolean
    durationMs: number
}

export interface QueryErrorInfo {
    message: string
    code: string | null
    detail: string | null
    hint: string | null
    /** Offset in the submitted script, when PostgreSQL reported a position. */
    position: number | null
    statementIndex: number | null
}

export interface RunResult {
    runId: string
    status: 'success' | 'error' | 'cancelled' | 'timeout'
    mode: 'read' | 'write'
    results: StatementResult[]
    error: QueryErrorInfo | null
    committed: boolean
    durationMs: number
    notices: string[]
}

interface PgError {
    message: string
    code?: string
    detail?: string
    hint?: string
    position?: string
}

function describeError(
    error: unknown,
    statement: SqlStatement | null,
    index: number | null,
): QueryErrorInfo {
    if (error instanceof TransactionEscapedError) {
        return {
            message: error.message,
            code: null,
            detail: null,
            hint: null,
            position: null,
            statementIndex: index,
        }
    }
    const pg = error as PgError
    const position = pg.position && statement ? statement.start + Number(pg.position) - 1 : null
    return {
        message: pg.message ?? 'Query failed',
        code: pg.code ?? null,
        detail: pg.detail ?? null,
        hint: pg.hint ?? null,
        position,
        statementIndex: index,
    }
}

export async function runStatements(
    ctx: TxContext,
    statements: SqlStatement[],
    maxRows: number,
    onResult: (result: StatementResult) => void,
): Promise<void> {
    for (const [index, statement] of statements.entries()) {
        const started = performance.now()
        const output = await ctx.statement(statement.text, [], maxRows)
        await ctx.assertIntact()
        const names = await typeNames(
            ctx.client,
            output.fields.map((field) => field.dataTypeID),
        )
        onResult({
            index,
            sql: statement.text.slice(0, 2000),
            command: output.command,
            rowCount: output.rowCount,
            fields: output.fields.map((field) => ({
                name: field.name,
                type: names.get(field.dataTypeID) ?? String(field.dataTypeID),
            })),
            rows: toJsonRows(output.rows),
            truncated: output.truncated,
            durationMs: Math.round((performance.now() - started) * 10) / 10,
        })
    }
}

export async function executeScript(
    userId: string,
    projectId: string,
    input: z.infer<typeof runSchema>,
): Promise<RunResult> {
    const statements = splitStatements(input.sql)
    if (statements.length === 0) throw new AppError('bad_request', 'There is no SQL to run.')
    if (statements.length > 50)
        throw new AppError('bad_request', 'Run at most 50 statements at a time.')
    const control = statements.findIndex((statement) => isTransactionControl(statement.text))
    if (control !== -1) {
        throw new AppError(
            'unsupported',
            `Statement ${control + 1} controls transactions. DataForge wraps every run in its own transaction (read-only, or committed when every statement succeeds in write mode), so BEGIN, COMMIT, ROLLBACK and SET TRANSACTION are not supported.`,
        )
    }

    const target = await projectTarget(userId, projectId, input.mode)
    if (input.mode === 'write') await assertWithinQuota(target)

    const runId = input.runId ?? randomUUID()
    const maxRows = Math.min(input.maxRows ?? config().QUERY_MAX_ROWS, config().QUERY_MAX_ROWS)
    const results: StatementResult[] = []
    const started = performance.now()
    let failure: { error: unknown; index: number } | null = null
    let state = { cancelled: false, timedOut: false }
    let notices: string[] = []

    try {
        await withTargetTransaction(
            target,
            userId,
            input.mode,
            async (ctx) => {
                try {
                    await runStatements(ctx, statements, maxRows, (result) => results.push(result))
                } catch (error) {
                    failure = { error, index: results.length }
                    throw error
                } finally {
                    state = { cancelled: ctx.cancelled, timedOut: ctx.timedOut }
                    notices = ctx.notices
                }
            },
            { runId },
        )
    } catch (error) {
        if (!failure) failure = { error, index: results.length }
    }

    const durationMs = Math.round(performance.now() - started)
    const failed = failure as { error: unknown; index: number } | null
    let status: RunResult['status'] = 'success'
    let error: QueryErrorInfo | null = null
    if (failed) {
        const code = (failed.error as PgError).code
        status =
            state.cancelled && code === '57014'
                ? 'cancelled'
                : state.timedOut || code === '57014'
                  ? 'timeout'
                  : 'error'
        error = describeError(failed.error, statements[failed.index] ?? null, failed.index)
        if (status === 'cancelled') error.message = 'The query was cancelled.'
        if (status === 'timeout') {
            error.message = `The query ran longer than ${Math.round(config().QUERY_TIMEOUT_MS / 1000)} seconds and was stopped.`
        }
    }

    const totalRows = results.reduce(
        (sum, result) => sum + (result.rowCount ?? result.rows.length),
        0,
    )
    await recordQuery({
        projectId,
        userId,
        sql: input.sql,
        mode: input.mode,
        status,
        statementCount: statements.length,
        rowCount: totalRows,
        durationMs,
        errorCode: error?.code,
        errorMessage: error?.message,
    })

    return {
        runId,
        status,
        mode: input.mode,
        results,
        error,
        committed: input.mode === 'write' && status === 'success',
        durationMs,
        notices,
    }
}

export const explainSchema = z.object({
    sql: z.string().min(1).max(100_000),
    analyze: z.boolean().default(false),
    mode: z.enum(['read', 'write']).default('read'),
})

export interface ExplainResult {
    analyzed: boolean
    plan: unknown
    planningMs: number | null
    executionMs: number | null
    durationMs: number
}

/**
 * EXPLAIN of a single statement. Plain EXPLAIN only plans. EXPLAIN ANALYZE
 * executes the statement, so it never runs implicitly: the client must ask
 * for it, it runs under the selected role, and its transaction is always
 * rolled back, so even in write mode the statement's changes are discarded.
 */
export async function explainStatement(
    userId: string,
    projectId: string,
    input: z.infer<typeof explainSchema>,
): Promise<ExplainResult> {
    const statements = splitStatements(input.sql)
    if (statements.length !== 1) {
        throw new AppError('bad_request', 'Select a single statement to explain.')
    }
    const statement = statements[0]!
    if (isTransactionControl(statement.text) || /^\s*explain\b/i.test(statement.text)) {
        throw new AppError('bad_request', 'This statement cannot be explained.')
    }
    const target = await projectTarget(userId, projectId, input.mode)
    const options = input.analyze
        ? 'ANALYZE, BUFFERS, TIMING, VERBOSE, COSTS, FORMAT JSON'
        : 'VERBOSE, COSTS, FORMAT JSON'
    const started = performance.now()
    const historyMode = input.analyze ? 'explain_analyze' : 'explain'
    try {
        const plan = await withTargetTransaction(
            target,
            userId,
            input.analyze ? (input.mode === 'read' ? 'read' : 'rollback') : 'read',
            async (ctx) => {
                const output = await ctx.statement(`EXPLAIN (${options}) ${statement.text}`, [], 10)
                await ctx.assertIntact()
                const value = output.rows[0]?.[0]
                return typeof value === 'string' ? JSON.parse(value) : value
            },
        )
        const root = (Array.isArray(plan) ? plan[0] : plan) as {
            'Planning Time'?: number
            'Execution Time'?: number
        }
        const durationMs = Math.round(performance.now() - started)
        await recordQuery({
            projectId,
            userId,
            sql: statement.text,
            mode: historyMode,
            status: 'success',
            statementCount: 1,
            rowCount: null,
            durationMs,
        })
        return {
            analyzed: input.analyze,
            plan,
            planningMs: root?.['Planning Time'] ?? null,
            executionMs: root?.['Execution Time'] ?? null,
            durationMs,
        }
    } catch (error) {
        const info = describeError(error, statement, 0)
        await recordQuery({
            projectId,
            userId,
            sql: statement.text,
            mode: historyMode,
            status: info.code === '57014' ? 'timeout' : 'error',
            statementCount: 1,
            rowCount: null,
            durationMs: Math.round(performance.now() - started),
            errorCode: info.code,
            errorMessage: info.message,
        })
        throw new AppError('database_error', info.message, info)
    }
}
