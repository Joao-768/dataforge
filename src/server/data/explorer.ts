import 'server-only'
import { z } from 'zod'
import { recordActivity } from '@/server/activity'
import { AppError, notFound } from '@/server/errors'
import { recordQuery } from '@/server/query/history'
import { withTargetTransaction } from '@/server/query/session'
import { toJsonRows, typeNames } from '@/server/query/values'
import { liveSchema } from '@/server/schema/cache'
import { assertWithinQuota, projectTarget, type Target } from '@/server/targets/connections'
import type { SchemaTable } from '@/shared/schema/model'
import { typeFamily } from '@/shared/schema/types'
import { qualify, quoteIdent } from '@/shared/sql/identifiers'

// Data explorer: paged, filtered reads and row-level writes.
//
// Table and column names come from the request but are only ever used after
// being matched against the introspected catalog, and are then quoted.
// Values are always bind parameters, cast to the column's catalog type
// ($1::numeric(10,2)), so PostgreSQL does the parsing and validation and
// constraint violations surface as the database reports them.

export const FILTER_OPERATORS = [
    'eq',
    'neq',
    'lt',
    'lte',
    'gt',
    'gte',
    'contains',
    'starts_with',
    'is_null',
    'not_null',
] as const

const tableRef = z.object({ schema: z.string().min(1).max(200), table: z.string().min(1).max(200) })

export const browseSchema = tableRef.extend({
    page: z.coerce.number().int().min(1).max(1_000_000).default(1),
    pageSize: z.coerce.number().int().min(10).max(200).default(50),
    sort: z.string().max(200).optional(),
    direction: z.enum(['asc', 'desc']).default('asc'),
    search: z.string().max(200).optional(),
    filters: z
        .string()
        .max(5000)
        .optional()
        .transform((raw, ctx) => {
            if (!raw) return []
            try {
                return z
                    .array(
                        z.object({
                            column: z.string().max(200),
                            op: z.enum(FILTER_OPERATORS),
                            value: z.string().max(1000).optional(),
                        }),
                    )
                    .max(10)
                    .parse(JSON.parse(raw))
            } catch {
                ctx.addIssue({ code: 'custom', message: 'Invalid filters' })
                return z.NEVER
            }
        }),
})

export type BrowseInput = z.infer<typeof browseSchema>

const cellInput = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('value'), value: z.string().max(1_000_000) }),
    z.object({ kind: z.literal('null') }),
    z.object({ kind: z.literal('default') }),
])
const keyValue = z.union([z.string(), z.number(), z.boolean(), z.null()])

export const insertSchema = tableRef.extend({
    values: z.record(z.string(), cellInput),
})

export const updateSchema = tableRef.extend({
    key: z.record(z.string(), keyValue),
    changes: z.record(z.string(), cellInput),
})

export const deleteSchema = tableRef.extend({
    keys: z.array(z.record(z.string(), keyValue)).min(1).max(500),
})

interface Relation {
    schema: string
    name: string
    kind: 'table' | 'view'
    table: SchemaTable | null
    columns: { name: string; type: string }[]
}

async function findRelation(target: Target, schema: string, name: string): Promise<Relation> {
    const live = await liveSchema(target)
    const table = live.tables.find(
        (candidate) => candidate.schema === schema && candidate.name === name,
    )
    if (table) {
        return {
            schema,
            name,
            kind: 'table',
            table,
            columns: table.columns.map((column) => ({ name: column.name, type: column.type })),
        }
    }
    const view = live.views.find(
        (candidate) => candidate.schema === schema && candidate.name === name,
    )
    if (view) return { schema, name, kind: 'view', table: null, columns: view.columns }
    throw notFound('Table')
}

function columnType(relation: Relation, name: string): string {
    const column = relation.columns.find((candidate) => candidate.name === name)
    if (!column) throw new AppError('bad_request', `Unknown column "${name}".`)
    return column.type
}

function primaryKeyColumns(relation: Relation): string[] | null {
    const table = relation.table
    if (!table?.primaryKey) return null
    return table.primaryKey.columns.map(
        (id) => table.columns.find((column) => column.id === id)!.name,
    )
}

class Params {
    values: unknown[] = []
    add(value: unknown, type: string): string {
        this.values.push(value)
        return `$${this.values.length}::${type}`
    }
    addText(value: string): string {
        this.values.push(value)
        return `$${this.values.length}`
    }
}

function escapeLike(value: string): string {
    return value.replace(/[\\%_]/g, (match) => `\\${match}`)
}

function whereClause(relation: Relation, input: BrowseInput, params: Params): string {
    const conditions: string[] = []
    for (const filter of input.filters) {
        const type = columnType(relation, filter.column)
        const column = quoteIdent(filter.column)
        const needsValue = filter.op !== 'is_null' && filter.op !== 'not_null'
        if (needsValue && filter.value === undefined) {
            throw new AppError('bad_request', `Filter on ${filter.column} needs a value.`)
        }
        const value = filter.value ?? ''
        switch (filter.op) {
            case 'is_null':
                conditions.push(`${column} IS NULL`)
                break
            case 'not_null':
                conditions.push(`${column} IS NOT NULL`)
                break
            case 'contains':
                conditions.push(
                    `${column}::text ILIKE '%' || ${params.addText(escapeLike(value))} || '%'`,
                )
                break
            case 'starts_with':
                conditions.push(`${column}::text ILIKE ${params.addText(escapeLike(value))} || '%'`)
                break
            default: {
                const operator = { eq: '=', neq: '<>', lt: '<', lte: '<=', gt: '>', gte: '>=' }[
                    filter.op
                ]
                const family = typeFamily(type)
                // json has no equality operator; compare its text instead.
                if (family === 'json' && (filter.op === 'eq' || filter.op === 'neq')) {
                    conditions.push(`${column}::text ${operator} ${params.addText(value)}`)
                } else {
                    conditions.push(`${column} ${operator} ${params.add(value, type)}`)
                }
            }
        }
    }
    const search = input.search?.trim()
    if (search) {
        const searchable = relation.columns.filter((column) =>
            ['text', 'uuid', 'json'].includes(typeFamily(column.type)),
        )
        if (searchable.length > 0) {
            const pattern = params.addText(`%${escapeLike(search)}%`)
            conditions.push(
                `(${searchable.map((column) => `${quoteIdent(column.name)}::text ILIKE ${pattern}`).join(' OR ')})`,
            )
        }
    }
    return conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
}

export async function browse(userId: string, projectId: string, input: BrowseInput) {
    const target = await projectTarget(userId, projectId, 'read')
    const relation = await findRelation(target, input.schema, input.table)
    const primaryKey = primaryKeyColumns(relation)
    const params = new Params()
    const where = whereClause(relation, input, params)
    const from = qualify(relation.schema, relation.name)

    const order: string[] = []
    if (input.sort) {
        columnType(relation, input.sort)
        order.push(`${quoteIdent(input.sort)} ${input.direction.toUpperCase()} NULLS LAST`)
    }
    // The primary key breaks ties, so pages are stable.
    for (const column of primaryKey ?? []) {
        if (column !== input.sort) order.push(`${quoteIdent(column)} ASC`)
    }
    const orderBy = order.length > 0 ? `ORDER BY ${order.join(', ')}` : ''
    const offset = (input.page - 1) * input.pageSize
    const COUNT_CAP = 10_000

    const result = await withTargetTransaction(target, userId, 'read', async (ctx) => {
        const rows = await ctx.statement(
            `SELECT * FROM ${from} ${where} ${orderBy} LIMIT ${input.pageSize} OFFSET ${offset}`,
            params.values,
            input.pageSize,
        )
        const count = await ctx.client.query<{ count: string }>(
            `SELECT count(*) FROM (SELECT 1 FROM ${from} ${where} LIMIT ${COUNT_CAP + 1}) AS limited`,
            params.values,
        )
        const names = await typeNames(
            ctx.client,
            rows.fields.map((field) => field.dataTypeID),
        )
        return { rows, count: Number(count.rows[0]!.count), names }
    })

    const capped = result.count > COUNT_CAP
    const estimate = relation.table?.rowEstimate ?? null
    return {
        table: { schema: relation.schema, name: relation.name, kind: relation.kind },
        columns: result.rows.fields.map((field) => {
            const column = relation.table?.columns.find(
                (candidate) => candidate.name === field.name,
            )
            return {
                name: field.name,
                type: column?.type ?? result.names.get(field.dataTypeID) ?? 'unknown',
                nullable: column?.nullable ?? true,
                default: column?.default ?? null,
                identity: column?.identity ?? null,
                generated: column?.generated ?? null,
                comment: column?.comment ?? null,
                isPrimaryKey: primaryKey?.includes(field.name) ?? false,
            }
        }),
        primaryKey,
        rows: toJsonRows(result.rows.rows),
        page: input.page,
        pageSize: input.pageSize,
        total: capped ? (where || !estimate ? null : estimate) : result.count,
        totalCapped: capped,
        editable: relation.kind === 'table' && primaryKey !== null && target.connection.canWrite,
        readOnlyReason:
            relation.kind === 'view'
                ? 'Views are read-only here.'
                : primaryKey === null
                  ? 'Rows can only be edited in tables with a primary key.'
                  : !target.connection.canWrite
                    ? 'This connection has no write credentials.'
                    : null,
    }
}

function encodeValue(value: string | number | boolean | null): string | null {
    if (value === null) return null
    return typeof value === 'string' ? value : String(value)
}

async function writeTarget(userId: string, projectId: string, schema: string, table: string) {
    const target = await projectTarget(userId, projectId, 'write')
    await assertWithinQuota(target)
    const relation = await findRelation(target, schema, table)
    if (relation.kind !== 'table') throw new AppError('unsupported', 'Views are read-only.')
    return { target, relation }
}

async function runWrite(
    userId: string,
    projectId: string,
    target: Target,
    sql: string,
    values: unknown[],
    describe: string,
    expectedRows?: number,
) {
    const started = performance.now()
    try {
        const output = await withTargetTransaction(target, userId, 'write', async (ctx) => {
            const result = await ctx.statement(sql, values, 500)
            if (expectedRows !== undefined && result.rowCount !== expectedRows) {
                throw new AppError(
                    'conflict',
                    expectedRows === 1
                        ? 'The row was changed or deleted by someone else. Reload and try again.'
                        : `Expected to change ${expectedRows} rows but matched ${result.rowCount}. Nothing was changed.`,
                )
            }
            const names = await typeNames(
                ctx.client,
                result.fields.map((field) => field.dataTypeID),
            )
            return { ...result, names }
        })
        await recordQuery({
            projectId,
            userId,
            sql,
            mode: 'write',
            status: 'success',
            statementCount: 1,
            rowCount: output.rowCount,
            durationMs: performance.now() - started,
            source: 'explorer',
        })
        await recordActivity({ userId, projectId, kind: 'data.changed', message: describe })
        return {
            rowCount: output.rowCount ?? 0,
            columns: output.fields.map((field) => field.name),
            rows: toJsonRows(output.rows),
        }
    } catch (error) {
        if (error instanceof AppError) throw error
        const pg = error as { message: string; code?: string; detail?: string; hint?: string }
        await recordQuery({
            projectId,
            userId,
            sql,
            mode: 'write',
            status: 'error',
            statementCount: 1,
            rowCount: null,
            durationMs: performance.now() - started,
            errorCode: pg.code,
            errorMessage: pg.message,
            source: 'explorer',
        })
        throw new AppError('database_error', pg.message, {
            code: pg.code ?? null,
            detail: pg.detail ?? null,
            hint: pg.hint ?? null,
        })
    }
}

function assignments(
    relation: Relation,
    values: Record<string, z.infer<typeof cellInput>>,
    params: Params,
): { column: string; expression: string }[] {
    return Object.entries(values).map(([name, input]) => {
        const type = columnType(relation, name)
        const column = relation.table!.columns.find((candidate) => candidate.name === name)!
        if (column.generated)
            throw new AppError('bad_request', `${name} is generated and cannot be set.`)
        if (input.kind === 'default') return { column: quoteIdent(name), expression: 'DEFAULT' }
        if (input.kind === 'null') return { column: quoteIdent(name), expression: 'NULL' }
        return { column: quoteIdent(name), expression: params.add(input.value, type) }
    })
}

function keyCondition(
    relation: Relation,
    key: Record<string, string | number | boolean | null>,
    params: Params,
): string {
    const primaryKey = primaryKeyColumns(relation)
    if (!primaryKey)
        throw new AppError('unsupported', 'Rows can only be changed in tables with a primary key.')
    return primaryKey
        .map((name) => {
            if (!(name in key)) throw new AppError('bad_request', `Missing key column ${name}.`)
            return `${quoteIdent(name)} = ${params.add(encodeValue(key[name]!), columnType(relation, name))}`
        })
        .join(' AND ')
}

export async function insertRow(
    userId: string,
    projectId: string,
    input: z.infer<typeof insertSchema>,
) {
    const { target, relation } = await writeTarget(userId, projectId, input.schema, input.table)
    const params = new Params()
    const set = assignments(relation, input.values, params)
    const sql =
        set.length === 0
            ? `INSERT INTO ${qualify(relation.schema, relation.name)} DEFAULT VALUES RETURNING *`
            : `INSERT INTO ${qualify(relation.schema, relation.name)} (${set.map((entry) => entry.column).join(', ')}) VALUES (${set.map((entry) => entry.expression).join(', ')}) RETURNING *`
    return runWrite(
        userId,
        projectId,
        target,
        sql,
        params.values,
        `Inserted a row into ${relation.name}`,
        1,
    )
}

export async function updateRow(
    userId: string,
    projectId: string,
    input: z.infer<typeof updateSchema>,
) {
    const { target, relation } = await writeTarget(userId, projectId, input.schema, input.table)
    const params = new Params()
    const set = assignments(relation, input.changes, params)
    if (set.length === 0) throw new AppError('bad_request', 'Nothing to update.')
    const where = keyCondition(relation, input.key, params)
    const sql = `UPDATE ${qualify(relation.schema, relation.name)} SET ${set.map((entry) => `${entry.column} = ${entry.expression}`).join(', ')} WHERE ${where} RETURNING *`
    return runWrite(
        userId,
        projectId,
        target,
        sql,
        params.values,
        `Updated a row in ${relation.name}`,
        1,
    )
}

export async function deleteRows(
    userId: string,
    projectId: string,
    input: z.infer<typeof deleteSchema>,
) {
    const { target, relation } = await writeTarget(userId, projectId, input.schema, input.table)
    const params = new Params()
    const conditions = input.keys.map((key) => `(${keyCondition(relation, key, params)})`)
    const sql = `DELETE FROM ${qualify(relation.schema, relation.name)} WHERE ${conditions.join(' OR ')}`
    const count = input.keys.length
    return runWrite(
        userId,
        projectId,
        target,
        sql,
        params.values,
        `Deleted ${count} row${count === 1 ? '' : 's'} from ${relation.name}`,
        count,
    )
}
