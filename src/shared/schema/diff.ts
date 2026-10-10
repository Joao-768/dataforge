import {
    columnDefinition,
    commentStatement,
    createTableStatement,
    foreignKeyClause,
    foreignKeyName,
    primaryKeyClause,
    primaryKeyName,
    uniqueClause,
    uniqueName,
} from '@/shared/schema/ddl'
import type { ForeignKey, SchemaColumn, SchemaKey, SchemaTable } from '@/shared/schema/model'
import { normalizeType, parseType } from '@/shared/schema/types'
import { qualify, quoteIdent } from '@/shared/sql/identifiers'

// Computes the ordered DDL that turns a live schema (`base`) into a draft
// (`target`). Objects are matched by id, so renames are exact rather than
// guessed. The order is fixed and dependency-safe:
//
//   1. drop foreign keys that change or disappear (and those that depend on
//      a key being rebuilt)
//   2. drop unique and primary keys that change or disappear
//   3. drop tables
//   4. rename tables
//   5. per table: rename, drop, alter and add columns
//   6. create new tables (without foreign keys)
//   7. add primary and unique keys on existing tables
//   8. add foreign keys
//   9. comments
//
// Every step is one statement, so a failure is reported against the exact
// change that caused it.

export type StepKind =
    | 'drop_foreign_key'
    | 'drop_unique'
    | 'drop_primary_key'
    | 'drop_table'
    | 'rename_table'
    | 'rename_column'
    | 'drop_column'
    | 'drop_identity'
    | 'drop_default'
    | 'alter_column_type'
    | 'set_default'
    | 'set_not_null'
    | 'drop_not_null'
    | 'add_identity'
    | 'set_identity'
    | 'add_column'
    | 'create_table'
    | 'add_primary_key'
    | 'add_unique'
    | 'add_foreign_key'
    | 'comment'

export interface MigrationStep {
    kind: StepKind
    sql: string
    /** One-line description for the review screen. */
    summary: string
    /** Table the step belongs to, as schema.name after the migration. */
    table: string
    /** Removes data or structure that cannot be restored by rolling forward. */
    destructive: boolean
    /** Reason the step might fail or behave unexpectedly. */
    warning: string | null
}

export interface SchemaDiff {
    steps: MigrationStep[]
    summary: {
        tablesAdded: string[]
        tablesRemoved: string[]
        tablesRenamed: { from: string; to: string }[]
        columnsAdded: number
        columnsRemoved: number
        columnsChanged: number
        constraintsChanged: number
    }
}

const sameColumns = (a: string[], b: string[]) =>
    a.length === b.length && a.every((value, index) => value === b[index])

function sameKey(a: SchemaKey | null, b: SchemaKey | null): boolean {
    if (!a || !b) return a === b
    return a.id === b.id && sameColumns(a.columns, b.columns) && (a.name ?? '') === (b.name ?? '')
}

function sameForeignKey(a: ForeignKey, b: ForeignKey): boolean {
    return (
        sameKey(a, b) &&
        a.refTableId === b.refTableId &&
        sameColumns(a.refColumns, b.refColumns) &&
        a.onDelete === b.onDelete &&
        a.onUpdate === b.onUpdate
    )
}

/** Type changes PostgreSQL can make without losing information. */
export function isSafeTypeChange(from: string, to: string): boolean {
    const a = parseType(from)
    const b = parseType(to)
    if (a.array !== b.array) return false
    const rank: Record<string, number> = { smallint: 1, integer: 2, bigint: 3 }
    if (rank[a.base] && rank[b.base]) return rank[b.base]! >= rank[a.base]!
    if (a.base === 'varchar' && b.base === 'text') return true
    if (a.base === 'varchar' && b.base === 'varchar') {
        return b.args.length === 0 || (a.args.length > 0 && b.args[0]! >= a.args[0]!)
    }
    if (a.base === 'char' && (b.base === 'text' || b.base === 'varchar')) return b.args.length === 0
    if (a.base === 'numeric' && b.base === 'numeric') {
        if (b.args.length === 0) return true
        if (a.args.length === 0) return false
        const [ap, as = 0] = a.args
        const [bp, bs = 0] = b.args
        return bs >= as && bp! - bs >= ap! - as
    }
    if (a.base === 'real' && b.base === 'double precision') return true
    if (a.base === 'timestamp' && b.base === 'timestamptz') return false
    if (a.base === 'json' && b.base === 'jsonb') return true
    return false
}

function columnChanged(a: SchemaColumn, b: SchemaColumn): boolean {
    return (
        a.name !== b.name ||
        normalizeType(a.type) !== normalizeType(b.type) ||
        a.nullable !== b.nullable ||
        (a.default ?? null) !== (b.default ?? null) ||
        a.identity !== b.identity ||
        (a.comment ?? null) !== (b.comment ?? null)
    )
}

/**
 * Plans renames within one namespace. When a new name is still held by
 * another object that is itself being renamed (a swap), everything moves to a
 * temporary name first.
 */
function planRenames<T>(
    renames: { item: T; from: string; to: string }[],
    occupied: Set<string>,
): { item: T; from: string; to: string }[] {
    const freedBy = new Set(renames.map((rename) => rename.from))
    const conflict = renames.some((rename) => occupied.has(rename.to) && freedBy.has(rename.to))
    if (!conflict) return renames
    const temporary = renames.map((rename, index) => ({
        ...rename,
        to: `_df_rename_${index}`,
    }))
    const final = renames.map((rename, index) => ({ ...rename, from: `_df_rename_${index}` }))
    return [...temporary, ...final]
}

export function diffSchemas(base: SchemaTable[], target: SchemaTable[]): SchemaDiff {
    const steps: MigrationStep[] = []
    const baseById = new Map(base.map((table) => [table.id, table]))
    const targetById = new Map(target.map((table) => [table.id, table]))

    const kept = target.filter((table) => baseById.has(table.id))
    const created = target.filter((table) => !baseById.has(table.id))
    const dropped = base.filter((table) => !targetById.has(table.id))

    const summary: SchemaDiff['summary'] = {
        tablesAdded: created.map((table) => `${table.schema}.${table.name}`),
        tablesRemoved: dropped.map((table) => `${table.schema}.${table.name}`),
        tablesRenamed: [],
        columnsAdded: 0,
        columnsRemoved: 0,
        columnsChanged: 0,
        constraintsChanged: 0,
    }

    // Name a base table by its current name until step 4 renames it.
    const baseName = (table: SchemaTable) => qualify(table.schema, table.name)
    const label = (table: SchemaTable) => `${table.schema}.${table.name}`

    // ── keys being rebuilt, and foreign keys that depend on them ─────────────
    const rebuiltKeys: { tableId: string; columns: string[] }[] = []
    for (const after of kept) {
        const before = baseById.get(after.id)!
        if (before.primaryKey && !sameKey(before.primaryKey, after.primaryKey)) {
            rebuiltKeys.push({ tableId: before.id, columns: before.primaryKey.columns })
        }
        for (const unique of before.uniques) {
            const match = after.uniques.find((candidate) => candidate.id === unique.id)
            if (!match || !sameKey(unique, match)) {
                rebuiltKeys.push({ tableId: before.id, columns: unique.columns })
            }
        }
    }
    const dependsOnRebuiltKey = (key: ForeignKey) =>
        rebuiltKeys.some(
            (rebuilt) =>
                rebuilt.tableId === key.refTableId &&
                rebuilt.columns.length === key.refColumns.length &&
                rebuilt.columns.every((column) => key.refColumns.includes(column)),
        )

    // ── 1. drop foreign keys ─────────────────────────────────────────────────
    const foreignKeysToAdd: { table: SchemaTable; key: ForeignKey }[] = []
    for (const after of kept) {
        const before = baseById.get(after.id)!
        for (const key of before.foreignKeys) {
            const match = after.foreignKeys.find((candidate) => candidate.id === key.id)
            const unchanged = match && sameForeignKey(key, match) && !dependsOnRebuiltKey(match)
            if (unchanged) continue
            steps.push({
                kind: 'drop_foreign_key',
                sql: `ALTER TABLE ${baseName(before)} DROP CONSTRAINT ${quoteIdent(foreignKeyName(before, key))}`,
                summary: `Drop foreign key ${foreignKeyName(before, key)} on ${label(before)}`,
                table: label(after),
                destructive: false,
                warning: null,
            })
            if (match) foreignKeysToAdd.push({ table: after, key: match })
            else summary.constraintsChanged += 1
        }
        for (const key of after.foreignKeys) {
            if (!before.foreignKeys.some((candidate) => candidate.id === key.id)) {
                foreignKeysToAdd.push({ table: after, key })
            }
        }
    }
    // Foreign keys of tables being dropped that would block another step:
    // links between dropped tables (so the drops can run in any order) and
    // links into a key that step 2 rebuilds.
    const droppedIds = new Set(dropped.map((table) => table.id))
    for (const table of dropped) {
        for (const key of table.foreignKeys) {
            const betweenDropped = droppedIds.has(key.refTableId) && key.refTableId !== table.id
            if (betweenDropped || dependsOnRebuiltKey(key)) {
                steps.push({
                    kind: 'drop_foreign_key',
                    sql: `ALTER TABLE ${baseName(table)} DROP CONSTRAINT ${quoteIdent(foreignKeyName(table, key))}`,
                    summary: `Drop foreign key ${foreignKeyName(table, key)} on ${label(table)}`,
                    table: label(table),
                    destructive: false,
                    warning: null,
                })
            }
        }
    }

    // ── 2. drop unique and primary keys ──────────────────────────────────────
    const keysToAdd: { table: SchemaTable; key: SchemaKey; primary: boolean }[] = []
    for (const after of kept) {
        const before = baseById.get(after.id)!
        for (const unique of before.uniques) {
            const match = after.uniques.find((candidate) => candidate.id === unique.id)
            if (match && sameKey(unique, match)) continue
            steps.push({
                kind: 'drop_unique',
                sql: `ALTER TABLE ${baseName(before)} DROP CONSTRAINT ${quoteIdent(uniqueName(before, unique))}`,
                summary: `Drop unique constraint ${uniqueName(before, unique)} on ${label(before)}`,
                table: label(after),
                destructive: false,
                warning: null,
            })
            summary.constraintsChanged += 1
        }
        for (const unique of after.uniques) {
            const match = before.uniques.find((candidate) => candidate.id === unique.id)
            if (!match || !sameKey(match, unique))
                keysToAdd.push({ table: after, key: unique, primary: false })
        }
        if (!sameKey(before.primaryKey, after.primaryKey)) {
            if (before.primaryKey) {
                steps.push({
                    kind: 'drop_primary_key',
                    sql: `ALTER TABLE ${baseName(before)} DROP CONSTRAINT ${quoteIdent(primaryKeyName(before, before.primaryKey))}`,
                    summary: `Drop primary key on ${label(before)}`,
                    table: label(after),
                    destructive: false,
                    warning: after.primaryKey
                        ? null
                        : 'Rows in this table will no longer have a primary key.',
                })
            }
            if (after.primaryKey)
                keysToAdd.push({ table: after, key: after.primaryKey, primary: true })
            summary.constraintsChanged += 1
        }
    }

    // ── 3. drop tables ───────────────────────────────────────────────────────
    for (const table of dropped) {
        steps.push({
            kind: 'drop_table',
            sql: `DROP TABLE ${baseName(table)}`,
            summary: `Drop table ${label(table)}`,
            table: label(table),
            destructive: true,
            warning: 'Deletes the table and all of its rows.',
        })
    }

    // ── 4. rename tables ─────────────────────────────────────────────────────
    const tableRenames = kept
        .map((after) => ({ item: after, from: baseById.get(after.id)!.name, to: after.name }))
        .filter((rename) => rename.from !== rename.to)
    const occupiedTableNames = new Set(base.map((table) => table.name))
    for (const rename of planRenames(tableRenames, occupiedTableNames)) {
        steps.push({
            kind: 'rename_table',
            sql: `ALTER TABLE ${qualify(rename.item.schema, rename.from)} RENAME TO ${quoteIdent(rename.to)}`,
            summary: `Rename table ${rename.from} to ${rename.to}`,
            table: label(rename.item),
            destructive: false,
            warning: 'Queries and applications that use the old name will stop working.',
        })
    }
    summary.tablesRenamed = tableRenames.map((rename) => ({
        from: `${rename.item.schema}.${rename.from}`,
        to: label(rename.item),
    }))

    // ── 5. columns ───────────────────────────────────────────────────────────
    for (const after of kept) {
        const before = baseById.get(after.id)!
        const table = qualify(after.schema, after.name)
        const beforeColumns = new Map(before.columns.map((column) => [column.id, column]))
        const afterIds = new Set(after.columns.map((column) => column.id))
        const push = (step: Omit<MigrationStep, 'table'>) =>
            steps.push({ ...step, table: label(after) })

        const columnRenames = after.columns
            .filter((column) => beforeColumns.has(column.id))
            .map((column) => ({
                item: column,
                from: beforeColumns.get(column.id)!.name,
                to: column.name,
            }))
            .filter((rename) => rename.from !== rename.to)
        for (const rename of planRenames(
            columnRenames,
            new Set(before.columns.map((column) => column.name)),
        )) {
            push({
                kind: 'rename_column',
                sql: `ALTER TABLE ${table} RENAME COLUMN ${quoteIdent(rename.from)} TO ${quoteIdent(rename.to)}`,
                summary: `Rename column ${after.name}.${rename.from} to ${rename.to}`,
                destructive: false,
                warning: 'Queries that use the old column name will stop working.',
            })
        }

        for (const column of before.columns) {
            if (afterIds.has(column.id)) continue
            summary.columnsRemoved += 1
            push({
                kind: 'drop_column',
                sql: `ALTER TABLE ${table} DROP COLUMN ${quoteIdent(column.name)}`,
                summary: `Drop column ${after.name}.${column.name}`,
                destructive: true,
                warning: 'Deletes the column and its values in every row.',
            })
        }

        for (const column of after.columns) {
            const previous = beforeColumns.get(column.id)
            if (!previous) {
                summary.columnsAdded += 1
                const needsValue = !column.nullable && column.default === null && !column.identity
                push({
                    kind: 'add_column',
                    sql: `ALTER TABLE ${table} ADD COLUMN ${columnDefinition(column)}`,
                    summary: `Add column ${after.name}.${column.name} (${column.type})`,
                    destructive: false,
                    warning:
                        needsValue && before.rowEstimate !== 0
                            ? 'NOT NULL without a default fails if the table already has rows.'
                            : null,
                })
                continue
            }
            if (!columnChanged(previous, column)) continue
            summary.columnsChanged += 1
            const name = quoteIdent(column.name)
            const alter = `ALTER TABLE ${table} ALTER COLUMN ${name}`

            if (previous.identity && !column.identity) {
                push({
                    kind: 'drop_identity',
                    sql: `${alter} DROP IDENTITY`,
                    summary: `Stop generating values for ${after.name}.${column.name}`,
                    destructive: false,
                    warning: null,
                })
            }
            const defaultChanged = (previous.default ?? null) !== (column.default ?? null)
            if (defaultChanged && previous.default !== null && !previous.identity) {
                if (column.default === null || column.identity) {
                    push({
                        kind: 'drop_default',
                        sql: `${alter} DROP DEFAULT`,
                        summary: `Remove default from ${after.name}.${column.name}`,
                        destructive: false,
                        warning: null,
                    })
                }
            }
            if (normalizeType(previous.type) !== normalizeType(column.type)) {
                const safe = isSafeTypeChange(previous.type, column.type)
                push({
                    kind: 'alter_column_type',
                    sql: `${alter} TYPE ${column.type} USING ${name}::${column.type}`,
                    summary: `Change ${after.name}.${column.name} from ${previous.type} to ${column.type}`,
                    destructive: !safe,
                    warning: safe
                        ? null
                        : 'Existing values are converted; the change fails if a value does not fit, and precision can be lost.',
                })
            }
            if (defaultChanged && column.default !== null && !column.identity) {
                push({
                    kind: 'set_default',
                    sql: `${alter} SET DEFAULT ${column.default}`,
                    summary: `Set default of ${after.name}.${column.name} to ${column.default}`,
                    destructive: false,
                    warning: null,
                })
            }
            if (previous.nullable && !column.nullable) {
                push({
                    kind: 'set_not_null',
                    sql: `${alter} SET NOT NULL`,
                    summary: `Make ${after.name}.${column.name} required`,
                    destructive: false,
                    warning: 'Fails if any existing row has NULL in this column.',
                })
            }
            if (!previous.identity && column.identity) {
                push({
                    kind: 'add_identity',
                    sql: `${alter} ADD GENERATED ${column.identity === 'always' ? 'ALWAYS' : 'BY DEFAULT'} AS IDENTITY`,
                    summary: `Generate values for ${after.name}.${column.name}`,
                    destructive: false,
                    warning:
                        'The sequence starts at 1; existing values can collide with generated ones.',
                })
            } else if (
                previous.identity &&
                column.identity &&
                previous.identity !== column.identity
            ) {
                push({
                    kind: 'set_identity',
                    sql: `${alter} SET GENERATED ${column.identity === 'always' ? 'ALWAYS' : 'BY DEFAULT'}`,
                    summary: `Generate ${after.name}.${column.name} ${column.identity}`,
                    destructive: false,
                    warning: null,
                })
            }
            if (!previous.nullable && column.nullable && !column.identity) {
                push({
                    kind: 'drop_not_null',
                    sql: `${alter} DROP NOT NULL`,
                    summary: `Make ${after.name}.${column.name} optional`,
                    destructive: false,
                    warning: null,
                })
            }
        }
    }

    // ── 6. create tables ─────────────────────────────────────────────────────
    for (const table of created) {
        steps.push({
            kind: 'create_table',
            sql: createTableStatement(table),
            summary: `Create table ${label(table)} with ${table.columns.length} column${table.columns.length === 1 ? '' : 's'}`,
            table: label(table),
            destructive: false,
            warning: null,
        })
        for (const key of table.foreignKeys) foreignKeysToAdd.push({ table, key })
    }

    // ── 7. primary and unique keys on existing tables ────────────────────────
    for (const { table, key, primary } of keysToAdd) {
        const qualified = qualify(table.schema, table.name)
        steps.push(
            primary
                ? {
                      kind: 'add_primary_key',
                      sql: `ALTER TABLE ${qualified} ADD ${primaryKeyClause(table, key)}`,
                      summary: `Add primary key to ${label(table)}`,
                      table: label(table),
                      destructive: false,
                      warning: 'Fails if existing rows have duplicate or NULL key values.',
                  }
                : {
                      kind: 'add_unique',
                      sql: `ALTER TABLE ${qualified} ADD ${uniqueClause(table, key)}`,
                      summary: `Add unique constraint ${uniqueName(table, key)} to ${label(table)}`,
                      table: label(table),
                      destructive: false,
                      warning: 'Fails if existing rows have duplicate values.',
                  },
        )
    }

    // ── 8. foreign keys ──────────────────────────────────────────────────────
    for (const { table, key } of foreignKeysToAdd) {
        const referenced = targetById.get(key.refTableId)
        if (!referenced) continue // Reported by validation.
        summary.constraintsChanged += 1
        steps.push({
            kind: 'add_foreign_key',
            sql: `ALTER TABLE ${qualify(table.schema, table.name)} ADD ${foreignKeyClause(table, key, referenced)}`,
            summary: `Link ${label(table)} to ${label(referenced)} (${foreignKeyName(table, key)})`,
            table: label(table),
            destructive: false,
            warning: baseById.has(table.id)
                ? 'Fails if existing rows reference values that do not exist.'
                : null,
        })
    }

    // ── 9. comments ──────────────────────────────────────────────────────────
    for (const table of target) {
        const before = baseById.get(table.id)
        const qualified = qualify(table.schema, table.name)
        if ((before?.comment ?? null) !== (table.comment ?? null) && (before || table.comment)) {
            steps.push({
                kind: 'comment',
                sql: commentStatement(`TABLE ${qualified}`, table.comment),
                summary: `Update the description of ${label(table)}`,
                table: label(table),
                destructive: false,
                warning: null,
            })
        }
        for (const column of table.columns) {
            const previous = before?.columns.find((candidate) => candidate.id === column.id)
            if ((previous?.comment ?? null) === (column.comment ?? null)) continue
            if (!previous && !column.comment) continue
            steps.push({
                kind: 'comment',
                sql: commentStatement(
                    `COLUMN ${qualified}.${quoteIdent(column.name)}`,
                    column.comment,
                ),
                summary: `Update the description of ${table.name}.${column.name}`,
                table: label(table),
                destructive: false,
                warning: null,
            })
        }
    }

    return { steps, summary }
}

export function migrationScript(steps: MigrationStep[]): string {
    return steps.map((step) => `-- ${step.summary}\n${step.sql};`).join('\n\n')
}

export function hasDestructiveSteps(steps: MigrationStep[]): boolean {
    return steps.some((step) => step.destructive)
}
