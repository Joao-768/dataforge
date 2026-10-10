import 'server-only'
import { randomUUID } from 'node:crypto'
import type pg from 'pg'
import Cursor from 'pg-cursor'
import { config } from '@/server/config'
import { AppError } from '@/server/errors'
import { log } from '@/server/logger'
import type { Target } from '@/server/targets/connections'
import { connectOnce } from '@/server/targets/pools'
import { signalBackend } from '@/server/targets/provisioner'

// The harness every piece of user-visible SQL runs in: SQL editor scripts,
// EXPLAIN, data explorer reads and writes, imports and exports.
//
//   - A dedicated connection for the role the operation needs (read-only
//     role for reads, owner role for writes).
//   - An explicit transaction: READ ONLY for reads, committed only when
//     every statement succeeded for writes, always rolled back for
//     EXPLAIN ANALYZE.
//   - After each user statement, a check that the transaction is still the
//     one DataForge opened and (for reads) still read-only. A statement that
//     escaped it ends the run before anything else executes.
//   - A wall-clock watchdog that cancels, then terminates, the backend, so a
//     query that disables its own statement_timeout still stops.
//   - DISCARD ALL before the connection returns to the pool, so session
//     state (SET, temp tables, advisory locks, prepared statements) never
//     leaks from one run into the next.

export type TxMode = 'read' | 'write' | 'rollback'

interface RunningQuery {
    userId: string
    pid: number
    target: Target
    cancelled: boolean
    timedOut: boolean
}

const running = new Map<string, RunningQuery>()

export interface TxContext {
    client: pg.PoolClient
    runId: string
    /** Runs one statement through a portal, fetching at most `maxRows + 1` rows. */
    statement(text: string, values?: unknown[], maxRows?: number): Promise<CursorResult>
    /** Opens a portal for streaming reads; the caller reads and closes it. */
    cursor(text: string, values?: unknown[]): Cursor
    /** Throws if a statement ended or altered DataForge's transaction. */
    assertIntact(): Promise<void>
    notices: string[]
    readonly cancelled: boolean
    readonly timedOut: boolean
}

export interface CursorResult {
    rows: unknown[][]
    fields: pg.FieldDef[]
    command: string | null
    rowCount: number | null
    truncated: boolean
}

export class TransactionEscapedError extends Error {
    constructor() {
        super(
            "A statement ended or changed DataForge's transaction (for example COMMIT, ROLLBACK or SET TRANSACTION). Each run is already wrapped in a transaction, so these statements are not supported.",
        )
    }
}

function readCursor(cursor: Cursor, rows: number) {
    return new Promise<{ rows: unknown[][]; result: pg.QueryResult }>((resolve, reject) => {
        cursor.read(rows, (error, fetched, result) => {
            if (error) reject(error)
            else resolve({ rows: fetched as unknown as unknown[][], result })
        })
    })
}

export async function withTargetTransaction<T>(
    target: Target,
    userId: string,
    mode: TxMode,
    work: (ctx: TxContext) => Promise<T>,
    options: { runId?: string; timeoutMs?: number } = {},
): Promise<T> {
    const runId = options.runId ?? randomUUID()
    const timeoutMs = options.timeoutMs ?? config().QUERY_TIMEOUT_MS
    let client: pg.PoolClient
    try {
        client = await target.pool.connect()
    } catch (error) {
        const message = (error as Error).message
        throw new AppError('target_unavailable', `Could not reach the database: ${message}`)
    }

    const entry: RunningQuery = {
        userId,
        pid: (client as unknown as { processID: number }).processID,
        target,
        cancelled: false,
        timedOut: false,
    }
    running.set(runId, entry)

    const notices: string[] = []
    const onNotice = (notice: { message?: string; severity?: string }) => {
        if (notices.length < 50) notices.push(`${notice.severity ?? 'NOTICE'}: ${notice.message}`)
    }
    client.on('notice', onNotice)

    let destroy = false
    const softTimer = setTimeout(() => {
        entry.timedOut = true
        void signal(entry, 'cancel')
    }, timeoutMs + 2_000)
    const hardTimer = setTimeout(() => {
        destroy = true
        void signal(entry, 'terminate')
    }, timeoutMs + 10_000)

    let startedAt = ''
    const ctx: TxContext = {
        client,
        runId,
        notices,
        get cancelled() {
            return entry.cancelled
        },
        get timedOut() {
            return entry.timedOut
        },
        async statement(text, values = [], maxRows = config().QUERY_MAX_ROWS) {
            const cursor = client.query(new Cursor(text, values, { rowMode: 'array' }))
            try {
                const { rows, result } = await readCursor(cursor, maxRows + 1)
                const truncated = rows.length > maxRows
                return {
                    rows: truncated ? rows.slice(0, maxRows) : rows,
                    fields: result.fields ?? [],
                    command: result.command ?? null,
                    rowCount: truncated ? null : (result.rowCount ?? rows.length),
                    truncated,
                }
            } finally {
                await cursor.close().catch(() => undefined)
            }
        },
        cursor(text, values = []) {
            return client.query(new Cursor(text, values, { rowMode: 'array' }))
        },
        async assertIntact() {
            const check = await client.query<{ started: string; read_only: string }>(
                `SELECT extract(epoch FROM now())::text AS started, current_setting('transaction_read_only') AS read_only`,
            )
            const row = check.rows[0]!
            if (row.started !== startedAt) throw new TransactionEscapedError()
            if (mode === 'read' && row.read_only !== 'on') throw new TransactionEscapedError()
        },
    }

    let committed = false
    try {
        await client.query(mode === 'read' ? 'BEGIN READ ONLY' : 'BEGIN')
        await client.query(`SET LOCAL statement_timeout = ${Math.floor(timeoutMs)}`)
        // Taking a snapshot here also locks in READ ONLY: PostgreSQL refuses
        // SET TRANSACTION READ WRITE once a query has run in the transaction.
        const begin = await client.query<{ started: string }>(
            'SELECT extract(epoch FROM now())::text AS started',
        )
        startedAt = begin.rows[0]!.started
        const result = await work(ctx)
        if (mode === 'write') {
            await ctx.assertIntact()
            await client.query('COMMIT')
            committed = true
        }
        return result
    } finally {
        clearTimeout(softTimer)
        clearTimeout(hardTimer)
        running.delete(runId)
        client.off('notice', onNotice)
        if (!committed) await client.query('ROLLBACK').catch(() => (destroy = true))
        if (!destroy) await client.query('DISCARD ALL').catch(() => (destroy = true))
        client.release(destroy)
    }
}

async function signal(entry: RunningQuery, mode: 'cancel' | 'terminate') {
    try {
        if (entry.target.connection.kind === 'managed') {
            await signalBackend(entry.pid, mode)
            return
        }
        // External servers: a role can always signal its own backends.
        const client = await connectOnce(entry.target.credentials)
        try {
            const fn = mode === 'cancel' ? 'pg_cancel_backend' : 'pg_terminate_backend'
            await client.query(`SELECT ${fn}($1)`, [entry.pid])
        } finally {
            await client.end().catch(() => undefined)
        }
    } catch (error) {
        log.warn({ err: error, mode }, 'could not signal backend')
    }
}

/** Cancels a run started by `userId`. Returns false if it is not running. */
export async function cancelRun(userId: string, runId: string): Promise<boolean> {
    const entry = running.get(runId)
    if (!entry || entry.userId !== userId) return false
    entry.cancelled = true
    await signal(entry, 'cancel')
    return true
}
