import type { DraftDocument, SchemaTable } from '@/shared/schema/model'
import { columnById } from '@/shared/schema/model'
import { keyTypesCompatible, parseType, typeProblem } from '@/shared/schema/types'
import { MAX_IDENTIFIER_BYTES, identifierBytes } from '@/shared/sql/identifiers'

// Validation of a draft before SQL is generated. The designer shows these
// issues inline; the server runs the same checks and refuses to generate a
// migration while any error remains.

export interface SchemaIssue {
    severity: 'error' | 'warning'
    message: string
    tableId: string
    columnId?: string
    constraintId?: string
}

function nameProblem(name: string, what: string): string | null {
    if (name.trim() === '') return `${what} needs a name`
    if (name !== name.trim()) return `${what} name has leading or trailing spaces`
    if (identifierBytes(name) > MAX_IDENTIFIER_BYTES) {
        return `${what} name is longer than ${MAX_IDENTIFIER_BYTES} bytes`
    }
    if (name.includes('\0')) return `${what} name contains a NUL character`
    return null
}

/**
 * Rejects default expressions that could carry more than one expression
 * (a statement terminator, comments or unbalanced brackets). The expression
 * itself is still checked by PostgreSQL when the migration runs.
 */
export function defaultExpressionProblem(expression: string): string | null {
    if (expression.trim() === '') return 'Default is empty'
    let depth = 0
    let i = 0
    while (i < expression.length) {
        const char = expression[i]!
        if (char === "'" || char === '"') {
            const close = expression.indexOf(char, i + 1)
            if (close === -1) return 'Default has an unterminated quote'
            i = close + 1
            // A doubled quote continues the same literal.
            while (expression[i] === char) {
                const next = expression.indexOf(char, i + 1)
                if (next === -1) return 'Default has an unterminated quote'
                i = next + 1
            }
            continue
        }
        if (char === ';') return 'Default cannot contain a semicolon'
        if (char === '$') return 'Default cannot contain dollar quotes or parameters'
        if (char === '-' && expression[i + 1] === '-') return 'Default cannot contain comments'
        if (char === '/' && expression[i + 1] === '*') return 'Default cannot contain comments'
        if (char === '(') depth += 1
        if (char === ')') {
            depth -= 1
            if (depth < 0) return 'Default has unbalanced parentheses'
        }
        i += 1
    }
    if (depth !== 0) return 'Default has unbalanced parentheses'
    return null
}

export function validateTables(tables: SchemaTable[], base: SchemaTable[] = []): SchemaIssue[] {
    const issues: SchemaIssue[] = []
    const byId = new Map(tables.map((table) => [table.id, table]))
    const baseById = new Map(base.map((table) => [table.id, table]))
    const error = (issue: Omit<SchemaIssue, 'severity'>) =>
        issues.push({ severity: 'error', ...issue })
    const warn = (issue: Omit<SchemaIssue, 'severity'>) =>
        issues.push({ severity: 'warning', ...issue })

    const seen = new Map<string, string>()
    for (const table of tables) {
        const problem = nameProblem(table.name, 'Table')
        if (problem) error({ tableId: table.id, message: problem })
        const qualifiedName = `${table.schema}.${table.name}`
        if (seen.has(qualifiedName)) {
            error({ tableId: table.id, message: `Another table is already named "${table.name}"` })
        }
        seen.set(qualifiedName, table.id)

        const before = baseById.get(table.id)
        if (before && before.schema !== table.schema) {
            error({
                tableId: table.id,
                message: 'Moving a table to another schema is not supported',
            })
        }
        if (table.columns.length === 0) {
            error({ tableId: table.id, message: `Table "${table.name}" has no columns` })
        }

        const columnNames = new Set<string>()
        for (const column of table.columns) {
            const at = { tableId: table.id, columnId: column.id }
            const columnProblem = nameProblem(column.name, 'Column')
            if (columnProblem) error({ ...at, message: columnProblem })
            if (columnNames.has(column.name)) {
                error({ ...at, message: `Duplicate column "${column.name}" in ${table.name}` })
            }
            columnNames.add(column.name)

            const typeIssue = typeProblem(column.type)
            if (typeIssue) error({ ...at, message: `${column.name}: ${typeIssue}` })
            if (!/^[A-Za-z_"]/.test(column.type.trim())) {
                error({ ...at, message: `${column.name}: "${column.type}" is not a valid type` })
            }

            if (column.identity) {
                const parsed = parseType(column.type)
                if (!parsed.info?.identity || parsed.array) {
                    error({
                        ...at,
                        message: `${column.name}: identity needs smallint, integer or bigint`,
                    })
                }
                if (column.nullable)
                    error({ ...at, message: `${column.name}: identity columns must be NOT NULL` })
                if (column.default !== null) {
                    error({
                        ...at,
                        message: `${column.name}: identity columns cannot have a default`,
                    })
                }
            }
            if (column.default !== null) {
                const defaultIssue = defaultExpressionProblem(column.default)
                if (defaultIssue) error({ ...at, message: `${column.name}: ${defaultIssue}` })
            }

            const previous = before?.columns.find((candidate) => candidate.id === column.id)
            if (previous && previous.generated !== column.generated) {
                error({ ...at, message: `${column.name}: generated columns cannot be edited here` })
            }
        }

        const checkKey = (columns: string[], what: string, constraintId: string) => {
            if (new Set(columns).size !== columns.length) {
                error({ tableId: table.id, constraintId, message: `${what} lists a column twice` })
            }
            for (const id of columns) {
                if (!columnById(table, id)) {
                    error({
                        tableId: table.id,
                        constraintId,
                        message: `${what} refers to a removed column`,
                    })
                }
            }
        }
        if (table.primaryKey) {
            checkKey(table.primaryKey.columns, 'Primary key', table.primaryKey.id)
            for (const id of table.primaryKey.columns) {
                const column = columnById(table, id)
                if (column?.nullable) {
                    error({
                        tableId: table.id,
                        columnId: id,
                        message: `${column.name}: primary key columns must be NOT NULL`,
                    })
                }
            }
        } else if (table.columns.length > 0) {
            warn({
                tableId: table.id,
                message: `${table.name} has no primary key; rows cannot be edited in the data explorer`,
            })
        }
        for (const unique of table.uniques) checkKey(unique.columns, 'Unique constraint', unique.id)

        const fkNames = new Set<string>()
        for (const key of table.foreignKeys) {
            const at = { tableId: table.id, constraintId: key.id }
            checkKey(key.columns, 'Foreign key', key.id)
            if (key.name) {
                if (fkNames.has(key.name))
                    error({ ...at, message: `Duplicate constraint name ${key.name}` })
                fkNames.add(key.name)
            }
            const referenced = byId.get(key.refTableId)
            if (!referenced) {
                error({
                    ...at,
                    message: `${table.name}: a relationship points to a table that no longer exists`,
                })
                continue
            }
            if (key.columns.length !== key.refColumns.length) {
                error({ ...at, message: `${table.name}: relationship column counts do not match` })
                continue
            }
            const refColumns = key.refColumns.map((id) => columnById(referenced, id))
            if (refColumns.some((column) => !column)) {
                error({
                    ...at,
                    message: `${table.name}: relationship points to a removed column in ${referenced.name}`,
                })
                continue
            }
            const sameSet = (ids: string[]) =>
                ids.length === key.refColumns.length &&
                ids.every((id) => key.refColumns.includes(id))
            const backed =
                (referenced.primaryKey && sameSet(referenced.primaryKey.columns)) ||
                referenced.uniques.some((unique) => sameSet(unique.columns))
            if (!backed) {
                error({
                    ...at,
                    message: `${table.name} → ${referenced.name}: the referenced columns must be a primary key or unique`,
                })
            }
            key.columns.forEach((id, index) => {
                const local = columnById(table, id)
                const remote = refColumns[index]
                if (!local || !remote) return
                const compatible = keyTypesCompatible(local.type, remote.type)
                if (compatible === 'incompatible') {
                    error({
                        ...at,
                        columnId: id,
                        message: `${table.name}.${local.name} (${local.type}) cannot reference ${referenced.name}.${remote.name} (${remote.type})`,
                    })
                } else if (compatible === 'compatible') {
                    warn({
                        ...at,
                        columnId: id,
                        message: `${table.name}.${local.name} is ${local.type} but ${referenced.name}.${remote.name} is ${remote.type}; matching types index better`,
                    })
                }
                if (key.onDelete === 'SET NULL' && !local.nullable) {
                    error({
                        ...at,
                        columnId: id,
                        message: `${table.name}.${local.name}: ON DELETE SET NULL needs a nullable column`,
                    })
                }
                if (key.onDelete === 'SET DEFAULT' && local.default === null) {
                    warn({
                        ...at,
                        columnId: id,
                        message: `${table.name}.${local.name}: ON DELETE SET DEFAULT without a default sets NULL`,
                    })
                }
            })
        }
    }
    return issues
}

export function validateDraft(document: DraftDocument, base: SchemaTable[] = []): SchemaIssue[] {
    return validateTables(document.tables, base)
}

export function hasErrors(issues: SchemaIssue[]): boolean {
    return issues.some((issue) => issue.severity === 'error')
}
