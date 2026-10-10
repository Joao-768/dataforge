import 'server-only'
import { stringify } from 'csv-stringify/sync'
import { z } from 'zod'
import { notFound } from '@/server/errors'
import { recordQuery } from '@/server/query/history'
import { withTargetTransaction, type TxContext } from '@/server/query/session'
import { liveSchema } from '@/server/schema/cache'
import { projectTarget } from '@/server/targets/connections'
import { schemaScript } from '@/shared/schema/ddl'
import { qualify, quoteIdent } from '@/shared/sql/identifiers'

// Exports stream straight from a server-side cursor to the HTTP response,
// 1,000 rows at a time, with backpressure: memory use stays flat no matter
// how large the table is.

export const exportTableSchema = z.object({
    schema: z.string().min(1).max(200),
    table: z.string().min(1).max(200),
})

// csv-stringify writes true/false as 1/"" by default; keep PostgreSQL's
// spelling so an export imports back unchanged.
const CSV_CAST = {
    boolean: (value: boolean) => (value ? 'true' : 'false'),
    date: (value: Date) => value.toISOString(),
}

const BATCH = 1000
const MAX_ROWS = 1_000_000
const encoder = new TextEncoder()

function streamFromTransaction(
    run: (ctx: TxContext, write: (text: string) => Promise<void>) => Promise<void>,
    start: (work: (ctx: TxContext) => Promise<void>) => Promise<void>,
): ReadableStream<Uint8Array> {
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
    const writer = writable.getWriter()
    const write = async (text: string) => {
        await writer.ready
        await writer.write(encoder.encode(text))
    }
    start((ctx) => run(ctx, write)).then(
        () => writer.close(),
        (error) => writer.abort(error),
    )
    return readable
}

async function relationColumns(userId: string, projectId: string, schema: string, table: string) {
    const target = await projectTarget(userId, projectId, 'read')
    const live = await liveSchema(target)
    const found =
        live.tables.find((candidate) => candidate.schema === schema && candidate.name === table) ??
        null
    const view = live.views.find(
        (candidate) => candidate.schema === schema && candidate.name === table,
    )
    if (!found && !view) throw notFound('Table')
    return {
        target,
        table: found,
        columns: found
            ? found.columns.map((column) => column.name)
            : view!.columns.map((column) => column.name),
    }
}

export async function exportTableCsv(
    userId: string,
    projectId: string,
    schema: string,
    table: string,
) {
    const { target, columns } = await relationColumns(userId, projectId, schema, table)
    const sql = `SELECT ${columns.map(quoteIdent).join(', ')} FROM ${qualify(schema, table)}`
    const started = performance.now()
    let exported = 0
    return streamFromTransaction(
        async (ctx, write) => {
            await write(stringify([columns], { cast: CSV_CAST }))
            const cursor = ctx.cursor(sql)
            try {
                while (exported < MAX_ROWS) {
                    const rows = (await cursor.read(BATCH)) as unknown[][]
                    if (rows.length === 0) break
                    exported += rows.length
                    await write(
                        stringify(
                            rows.map((row) =>
                                row.map((value) =>
                                    value !== null && typeof value === 'object'
                                        ? JSON.stringify(value)
                                        : value,
                                ),
                            ),
                            { cast: CSV_CAST },
                        ),
                    )
                }
            } finally {
                await cursor.close().catch(() => undefined)
            }
            await recordQuery({
                projectId,
                userId,
                sql,
                mode: 'read',
                status: 'success',
                statementCount: 1,
                rowCount: exported,
                durationMs: performance.now() - started,
                source: 'export',
            })
        },
        (work) => withTargetTransaction(target, userId, 'read', work, { timeoutMs: 300_000 }),
    )
}

export async function exportTableSql(
    userId: string,
    projectId: string,
    schema: string,
    table: string,
) {
    const { target, table: definition } = await relationColumns(userId, projectId, schema, table)
    if (!definition) throw notFound('Table')
    const columns = definition.columns.filter((column) => !column.generated)
    const overriding = columns.some((column) => column.identity === 'always')
        ? ' OVERRIDING SYSTEM VALUE'
        : ''
    const header = `INSERT INTO ${qualify(schema, table)} (${columns.map((column) => quoteIdent(column.name)).join(', ')})${overriding} VALUES\n`
    // PostgreSQL renders every literal itself (quote_nullable), so escaping
    // follows the server's own rules for every type.
    const sql = `SELECT '(' || concat_ws(', ', ${columns
        .map((column) => `quote_nullable(${quoteIdent(column.name)})`)
        .join(', ')}) || ')' FROM ${qualify(schema, table)}`
    return streamFromTransaction(
        async (ctx, write) => {
            await write(`-- Data for ${schema}.${table}, exported by DataForge\n\n`)
            const cursor = ctx.cursor(sql)
            let exported = 0
            try {
                while (exported < MAX_ROWS) {
                    const rows = (await cursor.read(100)) as string[][]
                    if (rows.length === 0) break
                    exported += rows.length
                    await write(`${header}${rows.map((row) => `    ${row[0]}`).join(',\n')};\n\n`)
                }
            } finally {
                await cursor.close().catch(() => undefined)
            }
        },
        (work) => withTargetTransaction(target, userId, 'read', work, { timeoutMs: 300_000 }),
    )
}

export async function exportSchemaSql(userId: string, projectId: string): Promise<string> {
    const target = await projectTarget(userId, projectId, 'read')
    const live = await liveSchema(target, { fresh: true })
    const views = await withTargetTransaction(target, userId, 'read', async (ctx) => {
        const result = await ctx.client.query<{ statement: string }>(
            `SELECT format('CREATE %sVIEW %I.%I AS%s', CASE c.relkind WHEN 'm' THEN 'MATERIALIZED ' ELSE '' END,
                           n.nspname, c.relname, E'\\n' || rtrim(pg_get_viewdef(c.oid, true), ';')) AS statement
             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE c.relkind IN ('v', 'm')
               AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg\\_%'
             ORDER BY c.oid`,
        )
        return result.rows.map((row) => `${row.statement};`)
    })
    const header = [
        `-- Schema of ${target.connection.database}, exported by DataForge`,
        `-- ${new Date().toISOString()}`,
        '-- Tables, columns, keys, check constraints, indexes, comments and views.',
    ].join('\n')
    return `${schemaScript(live.tables, header)}${views.length ? `\n${views.join('\n\n')}\n` : ''}`
}
