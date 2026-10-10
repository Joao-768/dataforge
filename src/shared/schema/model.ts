import { z } from 'zod'

// The schema model shared by introspection, the visual designer, validation,
// diffing and SQL generation.
//
// Object identity: objects read from a live database carry ids derived from
// PostgreSQL's own identity (table OID, column attnum, constraint OID), so a
// renamed table or column is recognised as the same object when the draft is
// diffed against the database. Objects created in the designer get "n_" ids.

export const FK_ACTIONS = ['NO ACTION', 'RESTRICT', 'CASCADE', 'SET NULL', 'SET DEFAULT'] as const
export type FkAction = (typeof FK_ACTIONS)[number]

export const columnSchema = z.object({
    id: z.string().min(1).max(64),
    name: z.string().max(200),
    type: z.string().min(1).max(200),
    nullable: z.boolean(),
    default: z.string().max(2000).nullable(),
    identity: z.enum(['always', 'by default']).nullable(),
    /** Expression of a generated column. Shown, not editable. */
    generated: z.string().max(2000).nullable(),
    comment: z.string().max(2000).nullable(),
})

export const keySchema = z.object({
    id: z.string().min(1).max(64),
    name: z.string().max(200).nullable(),
    columns: z.array(z.string()).min(1).max(32),
})

export const foreignKeySchema = keySchema.extend({
    refTableId: z.string().min(1).max(64),
    refColumns: z.array(z.string()).min(1).max(32),
    onDelete: z.enum(FK_ACTIONS),
    onUpdate: z.enum(FK_ACTIONS),
})

export const tableSchema = z.object({
    id: z.string().min(1).max(64),
    schema: z.string().min(1).max(200),
    name: z.string().max(200),
    comment: z.string().max(2000).nullable(),
    columns: z.array(columnSchema).max(400),
    primaryKey: keySchema.nullable(),
    uniques: z.array(keySchema).max(64),
    foreignKeys: z.array(foreignKeySchema).max(64),
    /** Check and exclusion constraints: preserved, not editable. */
    checks: z.array(z.object({ name: z.string(), definition: z.string() })).max(128),
    /** Indexes that do not back a constraint: preserved, not editable. */
    indexes: z
        .array(z.object({ name: z.string(), definition: z.string(), unique: z.boolean() }))
        .max(128),
    /** Planner row estimate (live tables only); null when unknown. */
    rowEstimate: z.number().nullable(),
})

export const positionSchema = z.object({ x: z.number().finite(), y: z.number().finite() })

export const draftDocumentSchema = z.object({
    version: z.literal(1),
    tables: z.array(tableSchema).max(300),
    positions: z.record(z.string(), positionSchema),
})

export type SchemaColumn = z.infer<typeof columnSchema>
export type SchemaKey = z.infer<typeof keySchema>
export type ForeignKey = z.infer<typeof foreignKeySchema>
export type SchemaTable = z.infer<typeof tableSchema>
export type DraftDocument = z.infer<typeof draftDocumentSchema>
export type Position = z.infer<typeof positionSchema>

export interface SchemaView {
    schema: string
    name: string
    kind: 'view' | 'materialized view'
    columns: { name: string; type: string }[]
}

/** Everything introspection reads from a live database. */
export interface LiveSchema {
    schemas: string[]
    tables: SchemaTable[]
    views: SchemaView[]
}

export function tableKey(table: Pick<SchemaTable, 'schema' | 'name'>): string {
    return `${table.schema}.${table.name}`
}

export function newId(): string {
    const random =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? crypto.randomUUID().replaceAll('-', '').slice(0, 12)
            : Math.random().toString(36).slice(2, 14)
    return `n_${random}`
}

export function isNewObject(id: string): boolean {
    return id.startsWith('n_')
}

export function columnById(table: SchemaTable, id: string): SchemaColumn | undefined {
    return table.columns.find((column) => column.id === id)
}

export function columnNames(table: SchemaTable, ids: string[]): string[] {
    return ids.map((id) => columnById(table, id)?.name ?? '?')
}
