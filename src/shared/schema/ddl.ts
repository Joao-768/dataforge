import {
    MAX_IDENTIFIER_BYTES,
    identifierBytes,
    qualify,
    quoteIdent,
    quoteLiteral,
} from '@/shared/sql/identifiers'
import type { ForeignKey, SchemaColumn, SchemaKey, SchemaTable } from '@/shared/schema/model'

// DDL for single schema objects. The diff engine (diff.ts) decides which of
// these to emit and in what order.

export function columnDefinition(column: SchemaColumn): string {
    const parts = [quoteIdent(column.name), column.type]
    if (column.generated) {
        parts.push(`GENERATED ALWAYS AS (${column.generated}) STORED`)
    } else if (column.identity) {
        parts.push(
            `GENERATED ${column.identity === 'always' ? 'ALWAYS' : 'BY DEFAULT'} AS IDENTITY`,
        )
    }
    if (!column.nullable) parts.push('NOT NULL')
    if (column.default !== null && !column.identity && !column.generated) {
        parts.push(`DEFAULT ${column.default}`)
    }
    return parts.join(' ')
}

function truncateName(name: string): string {
    // PostgreSQL silently truncates long names; truncating here keeps the
    // generated SQL equal to what the database will actually store.
    let result = name
    while (identifierBytes(result) > MAX_IDENTIFIER_BYTES) result = result.slice(0, -1)
    return result
}

function columnList(table: SchemaTable, ids: string[]): string {
    return ids
        .map((id) => quoteIdent(table.columns.find((column) => column.id === id)?.name ?? id))
        .join(', ')
}

function names(table: SchemaTable, ids: string[]): string[] {
    return ids.map((id) => table.columns.find((column) => column.id === id)?.name ?? id)
}

export function primaryKeyName(table: SchemaTable, key: SchemaKey): string {
    return key.name ?? truncateName(`${table.name}_pkey`)
}

export function uniqueName(table: SchemaTable, key: SchemaKey): string {
    return key.name ?? truncateName(`${table.name}_${names(table, key.columns).join('_')}_key`)
}

export function foreignKeyName(table: SchemaTable, key: ForeignKey): string {
    return key.name ?? truncateName(`${table.name}_${names(table, key.columns).join('_')}_fkey`)
}

export function primaryKeyClause(table: SchemaTable, key: SchemaKey): string {
    return `CONSTRAINT ${quoteIdent(primaryKeyName(table, key))} PRIMARY KEY (${columnList(table, key.columns)})`
}

export function uniqueClause(table: SchemaTable, key: SchemaKey): string {
    return `CONSTRAINT ${quoteIdent(uniqueName(table, key))} UNIQUE (${columnList(table, key.columns)})`
}

export function foreignKeyClause(
    table: SchemaTable,
    key: ForeignKey,
    referenced: SchemaTable,
): string {
    let clause =
        `CONSTRAINT ${quoteIdent(foreignKeyName(table, key))} FOREIGN KEY (${columnList(table, key.columns)}) ` +
        `REFERENCES ${qualify(referenced.schema, referenced.name)} (${columnList(referenced, key.refColumns)})`
    if (key.onDelete !== 'NO ACTION') clause += ` ON DELETE ${key.onDelete}`
    if (key.onUpdate !== 'NO ACTION') clause += ` ON UPDATE ${key.onUpdate}`
    return clause
}

export function createTableStatement(table: SchemaTable): string {
    const lines = table.columns.map((column) => `    ${columnDefinition(column)}`)
    if (table.primaryKey) lines.push(`    ${primaryKeyClause(table, table.primaryKey)}`)
    for (const unique of table.uniques) lines.push(`    ${uniqueClause(table, unique)}`)
    for (const check of table.checks) {
        lines.push(`    CONSTRAINT ${quoteIdent(check.name)} ${check.definition}`)
    }
    return `CREATE TABLE ${qualify(table.schema, table.name)} (\n${lines.join(',\n')}\n)`
}

export function commentStatement(target: string, comment: string | null): string {
    return `COMMENT ON ${target} IS ${comment === null || comment === '' ? 'NULL' : quoteLiteral(comment)}`
}

/** Full DDL for a set of tables, as used by "Export schema". */
export function schemaScript(tables: SchemaTable[], header?: string): string {
    const byId = new Map(tables.map((table) => [table.id, table]))
    const statements: string[] = []
    const schemas = [...new Set(tables.map((table) => table.schema))].filter(
        (name) => name !== 'public',
    )
    for (const schema of schemas)
        statements.push(`CREATE SCHEMA IF NOT EXISTS ${quoteIdent(schema)}`)
    for (const table of tables) {
        statements.push(createTableStatement(table))
        if (table.comment) {
            statements.push(
                commentStatement(`TABLE ${qualify(table.schema, table.name)}`, table.comment),
            )
        }
        for (const column of table.columns) {
            if (column.comment) {
                statements.push(
                    commentStatement(
                        `COLUMN ${qualify(table.schema, table.name)}.${quoteIdent(column.name)}`,
                        column.comment,
                    ),
                )
            }
        }
    }
    for (const table of tables) {
        for (const key of table.foreignKeys) {
            const referenced = byId.get(key.refTableId)
            if (!referenced) continue
            statements.push(
                `ALTER TABLE ${qualify(table.schema, table.name)} ADD ${foreignKeyClause(table, key, referenced)}`,
            )
        }
    }
    for (const table of tables) {
        for (const index of table.indexes) statements.push(index.definition)
    }
    const body = statements.map((statement) => `${statement};`).join('\n\n')
    return header ? `${header}\n\n${body}\n` : `${body}\n`
}
