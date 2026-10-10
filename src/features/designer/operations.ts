import {
    newId,
    type DraftDocument,
    type FkAction,
    type ForeignKey,
    type Position,
    type SchemaColumn,
    type SchemaTable,
} from '@/shared/schema/model'
import { parseType } from '@/shared/schema/types'

// Pure edit operations on a draft document. Each returns a new document and
// keeps the model consistent: deleting a column removes it from every key
// and relationship that used it, deleting a table removes the relationships
// that pointed at it, primary key and identity columns are made NOT NULL.
// Kept pure (no store, no React) so they are unit-tested directly.

function mapTable(
    document: DraftDocument,
    tableId: string,
    change: (table: SchemaTable) => SchemaTable,
): DraftDocument {
    return {
        ...document,
        tables: document.tables.map((table) => (table.id === tableId ? change(table) : table)),
    }
}

function uniqueName(base: string, taken: Set<string>): string {
    if (!taken.has(base)) return base
    let index = 2
    while (taken.has(`${base}_${index}`)) index += 1
    return `${base}_${index}`
}

export function newColumn(
    name: string,
    type = 'text',
    patch: Partial<SchemaColumn> = {},
): SchemaColumn {
    return {
        id: newId(),
        name,
        type,
        nullable: true,
        default: null,
        identity: null,
        generated: null,
        comment: null,
        ...patch,
    }
}

export function addTable(
    document: DraftDocument,
    position: Position,
    schema = 'public',
): { document: DraftDocument; tableId: string } {
    const taken = new Set(
        document.tables.filter((table) => table.schema === schema).map((table) => table.name),
    )
    const id = newId()
    const pk = newColumn('id', 'bigint', { nullable: false, identity: 'always' })
    const table: SchemaTable = {
        id,
        schema,
        name: uniqueName('new_table', taken),
        comment: null,
        columns: [
            pk,
            newColumn('created_at', 'timestamptz', { nullable: false, default: 'now()' }),
        ],
        primaryKey: { id: newId(), name: null, columns: [pk.id] },
        uniques: [],
        foreignKeys: [],
        checks: [],
        indexes: [],
        rowEstimate: null,
    }
    return {
        document: {
            ...document,
            tables: [...document.tables, table],
            positions: { ...document.positions, [id]: position },
        },
        tableId: id,
    }
}

export function updateTable(
    document: DraftDocument,
    tableId: string,
    patch: Partial<Pick<SchemaTable, 'name' | 'comment'>>,
) {
    return mapTable(document, tableId, (table) => ({ ...table, ...patch }))
}

export function deleteTable(document: DraftDocument, tableId: string): DraftDocument {
    const positions = { ...document.positions }
    delete positions[tableId]
    return {
        ...document,
        positions,
        tables: document.tables
            .filter((table) => table.id !== tableId)
            .map((table) => ({
                ...table,
                foreignKeys: table.foreignKeys.filter((key) => key.refTableId !== tableId),
            })),
    }
}

export function addColumn(
    document: DraftDocument,
    tableId: string,
): { document: DraftDocument; columnId: string } {
    const table = document.tables.find((candidate) => candidate.id === tableId)!
    const column = newColumn(
        uniqueName('new_column', new Set(table.columns.map((existing) => existing.name))),
    )
    return {
        document: mapTable(document, tableId, (current) => ({
            ...current,
            columns: [...current.columns, column],
        })),
        columnId: column.id,
    }
}

export function updateColumn(
    document: DraftDocument,
    tableId: string,
    columnId: string,
    patch: Partial<Omit<SchemaColumn, 'id'>>,
): DraftDocument {
    return mapTable(document, tableId, (table) => {
        const isKey = table.primaryKey?.columns.includes(columnId) ?? false
        return {
            ...table,
            columns: table.columns.map((column) => {
                if (column.id !== columnId) return column
                const next = { ...column, ...patch }
                if (next.identity) {
                    // Identity needs an integer type, NOT NULL and no default.
                    if (!parseType(next.type).info?.identity) next.type = 'bigint'
                    next.nullable = false
                    next.default = null
                }
                if (isKey) next.nullable = false
                return next
            }),
        }
    })
}

/** Removes a column and every key and relationship that referenced it. */
export function deleteColumn(
    document: DraftDocument,
    tableId: string,
    columnId: string,
): DraftDocument {
    return {
        ...document,
        tables: document.tables.map((table) => {
            if (table.id === tableId) {
                const primaryKeyColumns =
                    table.primaryKey?.columns.filter((id) => id !== columnId) ?? []
                return {
                    ...table,
                    columns: table.columns.filter((column) => column.id !== columnId),
                    primaryKey:
                        primaryKeyColumns.length && table.primaryKey
                            ? { ...table.primaryKey, columns: primaryKeyColumns }
                            : null,
                    uniques: table.uniques
                        .map((unique) => ({
                            ...unique,
                            columns: unique.columns.filter((id) => id !== columnId),
                        }))
                        .filter((unique) => unique.columns.length > 0),
                    foreignKeys: table.foreignKeys.filter(
                        (key) =>
                            !key.columns.includes(columnId) &&
                            !(key.refTableId === tableId && key.refColumns.includes(columnId)),
                    ),
                }
            }
            return {
                ...table,
                foreignKeys: table.foreignKeys.filter(
                    (key) => !(key.refTableId === tableId && key.refColumns.includes(columnId)),
                ),
            }
        }),
    }
}

export function moveColumn(
    document: DraftDocument,
    tableId: string,
    columnId: string,
    direction: -1 | 1,
): DraftDocument {
    return mapTable(document, tableId, (table) => {
        const index = table.columns.findIndex((column) => column.id === columnId)
        const target = index + direction
        if (index < 0 || target < 0 || target >= table.columns.length) return table
        const columns = [...table.columns]
        ;[columns[index], columns[target]] = [columns[target]!, columns[index]!]
        return { ...table, columns }
    })
}

export function togglePrimaryKey(
    document: DraftDocument,
    tableId: string,
    columnId: string,
): DraftDocument {
    return mapTable(document, tableId, (table) => {
        const current = table.primaryKey?.columns ?? []
        const included = current.includes(columnId)
        const columns = included ? current.filter((id) => id !== columnId) : [...current, columnId]
        // The id stays stable: the diff compares columns, so toggling a column
        // off and on again leaves nothing to migrate.
        const primaryKey = columns.length
            ? { id: table.primaryKey?.id ?? newId(), name: table.primaryKey?.name ?? null, columns }
            : null
        return {
            ...table,
            primaryKey,
            columns: table.columns.map((column) =>
                column.id === columnId && !included ? { ...column, nullable: false } : column,
            ),
        }
    })
}

/** Toggles a single-column unique constraint on the column. */
export function toggleUnique(
    document: DraftDocument,
    tableId: string,
    columnId: string,
): DraftDocument {
    return mapTable(document, tableId, (table) => {
        const existing = table.uniques.find(
            (unique) => unique.columns.length === 1 && unique.columns[0] === columnId,
        )
        if (existing)
            return { ...table, uniques: table.uniques.filter((unique) => unique !== existing) }
        return {
            ...table,
            uniques: [...table.uniques, { id: newId(), name: null, columns: [columnId] }],
        }
    })
}

export function isColumnUnique(table: SchemaTable, columnId: string): boolean {
    return table.uniques.some(
        (unique) => unique.columns.length === 1 && unique.columns[0] === columnId,
    )
}

/** Whether `columnId` alone is a primary key or unique key of its table. */
export function isSingleColumnKey(table: SchemaTable, columnId: string): boolean {
    const primary = table.primaryKey?.columns
    return (primary?.length === 1 && primary[0] === columnId) || isColumnUnique(table, columnId)
}

export type ConnectResult = { document: DraftDocument; foreignKeyId: string } | { error: string }

/**
 * Creates a foreign key from `sourceColumnId` to `targetColumnId`, the
 * gesture of dragging one column onto another on the canvas. The target
 * must be a single-column primary or unique key, as PostgreSQL requires.
 */
export function connectColumns(
    document: DraftDocument,
    source: { tableId: string; columnId: string },
    target: { tableId: string; columnId: string },
): ConnectResult {
    const sourceTable = document.tables.find((table) => table.id === source.tableId)
    const targetTable = document.tables.find((table) => table.id === target.tableId)
    if (!sourceTable || !targetTable) return { error: 'Table not found' }
    if (source.tableId === target.tableId && source.columnId === target.columnId) {
        return { error: 'A column cannot reference itself' }
    }
    let from = source
    let to = target
    let fromTable = sourceTable
    let toTable = targetTable
    // Dragging from a key to a plain column means the plain column refers to
    // the key: flip the direction.
    if (
        isSingleColumnKey(sourceTable, source.columnId) &&
        !isSingleColumnKey(targetTable, target.columnId)
    ) {
        ;[from, to, fromTable, toTable] = [target, source, targetTable, sourceTable]
    }
    if (!isSingleColumnKey(toTable, to.columnId)) {
        const name = toTable.columns.find((column) => column.id === to.columnId)?.name
        return { error: `${toTable.name}.${name} must be a primary key or unique to be referenced` }
    }
    const exists = fromTable.foreignKeys.some(
        (key) =>
            key.columns.length === 1 &&
            key.columns[0] === from.columnId &&
            key.refTableId === toTable.id,
    )
    if (exists) return { error: 'That relationship already exists' }
    const key: ForeignKey = {
        id: newId(),
        name: null,
        columns: [from.columnId],
        refTableId: toTable.id,
        refColumns: [to.columnId],
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
    }
    return {
        document: mapTable(document, fromTable.id, (table) => ({
            ...table,
            foreignKeys: [...table.foreignKeys, key],
        })),
        foreignKeyId: key.id,
    }
}

/**
 * Adds a relationship from `tableId` to the primary key of `refTableId`,
 * creating a matching `<table>_id` column when none is given.
 */
export function addRelationship(
    document: DraftDocument,
    tableId: string,
    refTableId: string,
    columnId?: string,
): ConnectResult {
    const refTable = document.tables.find((table) => table.id === refTableId)
    const table = document.tables.find((candidate) => candidate.id === tableId)
    if (!refTable || !table) return { error: 'Table not found' }
    const key = refTable.primaryKey
    if (!key || key.columns.length !== 1) {
        return { error: `${refTable.name} needs a single-column primary key to be referenced` }
    }
    const refColumn = refTable.columns.find((column) => column.id === key.columns[0])!
    let next = document
    let localId = columnId
    if (!localId) {
        const singular = refTable.name.endsWith('s') ? refTable.name.slice(0, -1) : refTable.name
        const name = uniqueName(
            `${singular}_id`,
            new Set(table.columns.map((column) => column.name)),
        )
        const type = refColumn.type.replace(/^(smallint|integer|bigint)$/, '$1')
        const column = newColumn(name, type, { nullable: false })
        next = mapTable(next, tableId, (current) => ({
            ...current,
            columns: [...current.columns, column],
        }))
        localId = column.id
    }
    return connectColumns(
        next,
        { tableId, columnId: localId },
        { tableId: refTableId, columnId: refColumn.id },
    )
}

export function updateForeignKey(
    document: DraftDocument,
    tableId: string,
    foreignKeyId: string,
    patch: { onDelete?: FkAction; onUpdate?: FkAction },
): DraftDocument {
    return mapTable(document, tableId, (table) => ({
        ...table,
        // The diff sees the changed action and drops and re-adds the constraint.
        foreignKeys: table.foreignKeys.map((key) =>
            key.id === foreignKeyId ? { ...key, ...patch } : key,
        ),
    }))
}

export function deleteForeignKey(
    document: DraftDocument,
    tableId: string,
    foreignKeyId: string,
): DraftDocument {
    return mapTable(document, tableId, (table) => ({
        ...table,
        foreignKeys: table.foreignKeys.filter((key) => key.id !== foreignKeyId),
    }))
}

export function setPositions(
    document: DraftDocument,
    positions: Record<string, Position>,
): DraftDocument {
    return { ...document, positions: { ...document.positions, ...positions } }
}
