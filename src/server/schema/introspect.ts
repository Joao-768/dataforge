import 'server-only'
import { createHash } from 'node:crypto'
import type pg from 'pg'
import type {
    ForeignKey,
    FkAction,
    LiveSchema,
    SchemaTable,
    SchemaView,
} from '@/shared/schema/model'
import { normalizeType } from '@/shared/schema/types'

// Reads a database's structure from pg_catalog. Identity comes from the
// catalog itself: tables are "t<oid>", columns "c<oid>.<attnum>",
// constraints "k<oid>". Those ids survive renames, which is what lets the
// designer diff a renamed column as a rename instead of a drop and an add.

const USER_SCHEMAS = `
    n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND n.nspname NOT LIKE 'pg\\_%'
`

const FK_ACTION: Record<string, FkAction> = {
    a: 'NO ACTION',
    r: 'RESTRICT',
    c: 'CASCADE',
    n: 'SET NULL',
    d: 'SET DEFAULT',
}

const tableId = (oid: string | number) => `t${oid}`
const columnId = (oid: string | number, attnum: number) => `c${oid}.${attnum}`
const constraintId = (oid: string | number) => `k${oid}`

export async function introspect(client: Pick<pg.ClientBase, 'query'>): Promise<LiveSchema> {
    const schemas = await client.query<{ nspname: string }>(
        `SELECT n.nspname FROM pg_namespace n WHERE ${USER_SCHEMAS} ORDER BY n.nspname`,
    )

    const tables = await client.query<{
        oid: string
        schema: string
        name: string
        comment: string | null
        reltuples: number
    }>(
        `SELECT c.oid::text AS oid, n.nspname AS schema, c.relname AS name,
                obj_description(c.oid, 'pg_class') AS comment,
                c.reltuples::float8 AS reltuples
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE c.relkind IN ('r', 'p') AND NOT c.relispartition AND ${USER_SCHEMAS}
         ORDER BY n.nspname, c.relname`,
    )
    const oids = tables.rows.map((row) => row.oid)

    const columns = await client.query<{
        table_oid: string
        attnum: number
        name: string
        type: string
        not_null: boolean
        default_expr: string | null
        identity: string
        generated: string
        comment: string | null
    }>(
        `SELECT a.attrelid::text AS table_oid, a.attnum, a.attname AS name,
                format_type(a.atttypid, a.atttypmod) AS type,
                a.attnotnull AS not_null,
                pg_get_expr(d.adbin, d.adrelid) AS default_expr,
                a.attidentity AS identity,
                a.attgenerated AS generated,
                col_description(a.attrelid, a.attnum) AS comment
         FROM pg_attribute a
         LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
         WHERE a.attrelid = ANY($1::oid[]) AND a.attnum > 0 AND NOT a.attisdropped
         ORDER BY a.attrelid, a.attnum`,
        [oids],
    )

    const constraints = await client.query<{
        oid: string
        table_oid: string
        name: string
        type: 'p' | 'u' | 'f' | 'c' | 'x'
        columns: number[] | null
        ref_table_oid: string | null
        ref_columns: number[] | null
        on_update: string
        on_delete: string
        definition: string
    }>(
        `SELECT con.oid::text AS oid, con.conrelid::text AS table_oid, con.conname AS name,
                con.contype AS type, con.conkey AS columns,
                NULLIF(con.confrelid, 0)::text AS ref_table_oid, con.confkey AS ref_columns,
                con.confupdtype AS on_update, con.confdeltype AS on_delete,
                pg_get_constraintdef(con.oid) AS definition
         FROM pg_constraint con
         WHERE con.conrelid = ANY($1::oid[]) AND con.contype IN ('p', 'u', 'f', 'c', 'x')
         ORDER BY con.conrelid, con.contype, con.conname`,
        [oids],
    )

    const indexes = await client.query<{
        table_oid: string
        name: string
        definition: string
        is_unique: boolean
    }>(
        `SELECT i.indrelid::text AS table_oid, ic.relname AS name,
                pg_get_indexdef(i.indexrelid) AS definition, i.indisunique AS is_unique
         FROM pg_index i
         JOIN pg_class ic ON ic.oid = i.indexrelid
         WHERE i.indrelid = ANY($1::oid[])
           AND NOT EXISTS (
               SELECT 1 FROM pg_constraint c
               WHERE c.conindid = i.indexrelid AND c.conrelid = i.indrelid
                 AND c.contype IN ('p', 'u', 'x')
           )
         ORDER BY ic.relname`,
        [oids],
    )

    const views = await client.query<{
        oid: string
        schema: string
        name: string
        relkind: string
    }>(
        `SELECT c.oid::text AS oid, n.nspname AS schema, c.relname AS name, c.relkind
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE c.relkind IN ('v', 'm') AND ${USER_SCHEMAS}
         ORDER BY n.nspname, c.relname`,
    )
    const viewColumns = await client.query<{ oid: string; name: string; type: string }>(
        `SELECT a.attrelid::text AS oid, a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type
         FROM pg_attribute a
         WHERE a.attrelid = ANY($1::oid[]) AND a.attnum > 0 AND NOT a.attisdropped
         ORDER BY a.attrelid, a.attnum`,
        [views.rows.map((row) => row.oid)],
    )

    const byOid = new Map<string, SchemaTable>()
    for (const row of tables.rows) {
        byOid.set(row.oid, {
            id: tableId(row.oid),
            schema: row.schema,
            name: row.name,
            comment: row.comment,
            columns: [],
            primaryKey: null,
            uniques: [],
            foreignKeys: [],
            checks: [],
            indexes: [],
            // reltuples is -1 for a table that has never been vacuumed or analysed.
            rowEstimate: row.reltuples < 0 ? null : Math.round(row.reltuples),
        })
    }
    for (const row of columns.rows) {
        byOid.get(row.table_oid)?.columns.push({
            id: columnId(row.table_oid, row.attnum),
            name: row.name,
            type: normalizeType(row.type),
            nullable: !row.not_null,
            default: row.identity || row.generated ? null : row.default_expr,
            identity: row.identity === 'a' ? 'always' : row.identity === 'd' ? 'by default' : null,
            generated: row.generated === 's' ? (row.default_expr ?? null) : null,
            comment: row.comment,
        })
    }
    for (const row of constraints.rows) {
        const table = byOid.get(row.table_oid)
        if (!table) continue
        const ids = (row.columns ?? []).map((attnum) => columnId(row.table_oid, attnum))
        if (row.type === 'p') {
            table.primaryKey = { id: constraintId(row.oid), name: row.name, columns: ids }
        } else if (row.type === 'u') {
            table.uniques.push({ id: constraintId(row.oid), name: row.name, columns: ids })
        } else if (row.type === 'f' && row.ref_table_oid) {
            const key: ForeignKey = {
                id: constraintId(row.oid),
                name: row.name,
                columns: ids,
                refTableId: tableId(row.ref_table_oid),
                refColumns: (row.ref_columns ?? []).map((attnum) =>
                    columnId(row.ref_table_oid!, attnum),
                ),
                onUpdate: FK_ACTION[row.on_update] ?? 'NO ACTION',
                onDelete: FK_ACTION[row.on_delete] ?? 'NO ACTION',
            }
            table.foreignKeys.push(key)
        } else {
            table.checks.push({ name: row.name, definition: row.definition })
        }
    }
    for (const row of indexes.rows) {
        byOid.get(row.table_oid)?.indexes.push({
            name: row.name,
            definition: row.definition,
            unique: row.is_unique,
        })
    }

    const columnsByView = new Map<string, { name: string; type: string }[]>()
    for (const row of viewColumns.rows) {
        const list = columnsByView.get(row.oid) ?? []
        list.push({ name: row.name, type: normalizeType(row.type) })
        columnsByView.set(row.oid, list)
    }
    const viewList: SchemaView[] = views.rows.map((row) => ({
        schema: row.schema,
        name: row.name,
        kind: row.relkind === 'm' ? 'materialized view' : 'view',
        columns: columnsByView.get(row.oid) ?? [],
    }))

    return {
        schemas: schemas.rows.map((row) => row.nspname),
        tables: [...byOid.values()],
        views: viewList,
    }
}

/**
 * Stable hash of the structure (not statistics) of a schema. Two
 * introspections of an unchanged database produce the same fingerprint.
 */
export function fingerprint(tables: SchemaTable[]): string {
    const structural = tables
        .map((table) => ({ ...table, rowEstimate: null }))
        .sort((a, b) => a.id.localeCompare(b.id))
    return createHash('sha256').update(JSON.stringify(structural)).digest('hex').slice(0, 24)
}
