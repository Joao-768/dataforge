'use client'

import { loader, type Monaco } from '@monaco-editor/react'
import type { editor, Position } from 'monaco-editor'
import type { LiveSchema } from '@/shared/schema/model'
import { splitStatements } from '@/shared/sql/split'

// Monaco is served from this app's own origin (/monaco/vs, copied from the
// npm package at install time), never from a CDN.
loader.config({ paths: { vs: '/monaco/vs' } })

export const LANGUAGE = 'pgsql'

const KEYWORDS =
    `SELECT FROM WHERE GROUP BY ORDER HAVING LIMIT OFFSET JOIN LEFT RIGHT FULL INNER OUTER CROSS LATERAL ON USING
AS DISTINCT UNION ALL INTERSECT EXCEPT INSERT INTO VALUES UPDATE SET DELETE RETURNING WITH RECURSIVE CASE WHEN THEN ELSE END
AND OR NOT NULL IS IN EXISTS BETWEEN LIKE ILIKE ASC DESC NULLS FIRST LAST CREATE TABLE ALTER DROP INDEX VIEW PRIMARY KEY
FOREIGN REFERENCES UNIQUE CHECK DEFAULT CONSTRAINT CASCADE TRUNCATE EXPLAIN ANALYZE WINDOW OVER PARTITION FILTER COALESCE
NULLIF GREATEST LEAST CAST`.split(/\s+/)

const FUNCTIONS =
    `count sum avg min max now date_trunc extract to_char coalesce nullif lower upper length substring trim
concat concat_ws string_agg array_agg json_agg jsonb_agg jsonb_build_object jsonb_array_elements row_number rank dense_rank
lag lead first_value round floor ceil abs generate_series gen_random_uuid age interval percentile_cont`.split(
        /\s+/,
    )

/** A CSS colour token as #rrggbb; the CSS minifier may shorten it to #rgb or rgb(). */
function css(name: string): string {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    if (/^#[0-9a-f]{3}$/i.test(raw)) {
        return `#${[...raw.slice(1)].map((digit) => digit + digit).join('')}`
    }
    if (/^#[0-9a-f]{6}$/i.test(raw)) return raw
    const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(raw)
    if (rgb) {
        return `#${rgb
            .slice(1, 4)
            .map((value) => Number(value).toString(16).padStart(2, '0'))
            .join('')}`
    }
    return '#888888'
}

function hex(color: string): string {
    return color.replace('#', '')
}

/** Defines (or redefines) the editor theme from the current CSS tokens. */
export function defineTheme(monaco: Monaco, mode: 'light' | 'dark') {
    const name = `dataforge-${mode}`
    monaco.editor.defineTheme(name, {
        base: mode === 'dark' ? 'vs-dark' : 'vs',
        inherit: true,
        rules: [
            { token: 'keyword', foreground: hex(css('--syntax-keyword')) },
            { token: 'operator', foreground: hex(css('--ink-2')) },
            { token: 'string', foreground: hex(css('--syntax-string')) },
            { token: 'number', foreground: hex(css('--syntax-number')) },
            { token: 'comment', foreground: hex(css('--syntax-comment')), fontStyle: 'italic' },
            { token: 'predefined', foreground: hex(css('--syntax-type')) },
            { token: 'type', foreground: hex(css('--syntax-type')) },
        ],
        colors: {
            'editor.background': css('--paper'),
            'editor.foreground': css('--ink'),
            'editorLineNumber.foreground': css('--ink-3'),
            'editorLineNumber.activeForeground': css('--ink'),
            'editorGutter.background': css('--paper'),
            'editor.lineHighlightBackground': css('--raised'),
            'editor.lineHighlightBorder': css('--raised'),
            'editor.selectionBackground': `${css('--accent')}44`,
            'editorCursor.foreground': css('--accent'),
            'editorWidget.background': css('--panel'),
            'editorWidget.border': css('--rule-strong'),
            'editorSuggestWidget.background': css('--panel'),
            'editorSuggestWidget.border': css('--rule-strong'),
            'editorSuggestWidget.selectedBackground': css('--raised'),
            'editorIndentGuide.background1': css('--rule'),
            'scrollbarSlider.background': `${css('--rule-strong')}88`,
        },
    })
    return name
}

/** Tables referenced in a statement with their aliases: `FROM orders o` → { o: orders }. */
export function aliasesIn(statement: string): Map<string, string> {
    const aliases = new Map<string, string>()
    const pattern =
        /\b(?:from|join|update|into)\s+((?:"[^"]+"|[\w$]+)(?:\.(?:"[^"]+"|[\w$]+))?)(?:\s+(?:as\s+)?(?!on\b|where\b|join\b|left\b|right\b|inner\b|group\b|order\b|limit\b|set\b|using\b)([\w$]+))?/gi
    let match: RegExpExecArray | null
    while ((match = pattern.exec(statement))) {
        const table = match[1]!.replaceAll('"', '').split('.').at(-1)!
        aliases.set(table.toLowerCase(), table)
        if (match[2]) aliases.set(match[2].toLowerCase(), table)
    }
    return aliases
}

let registered = false

/**
 * Registers completion for table and column names from the live schema. The
 * schema is read through `getSchema` at request time, so it stays current
 * without re-registering.
 */
export function registerCompletion(monaco: Monaco, getSchema: () => LiveSchema | undefined) {
    if (registered) return
    registered = true
    monaco.languages.registerCompletionItemProvider(LANGUAGE, {
        triggerCharacters: ['.', ' '],
        provideCompletionItems(model: editor.ITextModel, position: Position) {
            const schema = getSchema()
            const word = model.getWordUntilPosition(position)
            const range = {
                startLineNumber: position.lineNumber,
                endLineNumber: position.lineNumber,
                startColumn: word.startColumn,
                endColumn: word.endColumn,
            }
            const kinds = monaco.languages.CompletionItemKind
            const text = model.getValue()
            const offset = model.getOffsetAt(position)
            const statement = splitStatements(text).find(
                (candidate) => offset >= candidate.start && offset <= candidate.end + 1,
            )
            const before = model.getValueInRange({
                startLineNumber: position.lineNumber,
                startColumn: 1,
                endLineNumber: position.lineNumber,
                endColumn: word.startColumn,
            })
            const relations = [
                ...(schema?.tables ?? []).map((table) => ({
                    name: table.name,
                    schema: table.schema,
                    columns: table.columns.map((column) => ({
                        name: column.name,
                        type: column.type,
                    })),
                    kind: 'table',
                })),
                ...(schema?.views ?? []).map((view) => ({ ...view, kind: 'view' })),
            ]

            // After "alias." suggest that table's columns only.
            const dotted = /([\w$"]+)\.$/.exec(before)
            if (dotted) {
                const aliases = aliasesIn(statement?.text ?? text)
                const tableName = aliases.get(dotted[1]!.replaceAll('"', '').toLowerCase())
                const relation = relations.find(
                    (candidate) => candidate.name === tableName || candidate.schema === dotted[1],
                )
                if (relation && relation.name === tableName) {
                    return {
                        suggestions: relation.columns.map((column) => ({
                            label: column.name,
                            kind: kinds.Field,
                            detail: column.type,
                            insertText: column.name,
                            range,
                        })),
                    }
                }
                const inSchema = relations.filter((candidate) => candidate.schema === dotted[1])
                return {
                    suggestions: inSchema.map((relation) => ({
                        label: relation.name,
                        kind: kinds.Struct,
                        insertText: relation.name,
                        range,
                    })),
                }
            }

            const aliases = aliasesIn(statement?.text ?? '')
            const inScope = new Set([...aliases.values()].map((name) => name.toLowerCase()))
            const suggestions = [
                ...relations.map((relation) => ({
                    label: relation.name,
                    kind: relation.kind === 'view' ? kinds.Interface : kinds.Struct,
                    detail: `${relation.kind} · ${relation.columns.length} columns`,
                    insertText: relation.name,
                    sortText: `1${relation.name}`,
                    range,
                })),
                ...relations
                    .filter((relation) => inScope.has(relation.name.toLowerCase()))
                    .flatMap((relation) =>
                        relation.columns.map((column) => ({
                            label: column.name,
                            kind: kinds.Field,
                            detail: `${relation.name} · ${column.type}`,
                            insertText: column.name,
                            sortText: `0${column.name}`,
                            range,
                        })),
                    ),
                ...KEYWORDS.map((keyword) => ({
                    label: keyword,
                    kind: kinds.Keyword,
                    insertText: keyword,
                    sortText: `3${keyword}`,
                    range,
                })),
                ...FUNCTIONS.map((fn) => ({
                    label: fn,
                    kind: kinds.Function,
                    insertText: `${fn}($0)`,
                    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                    sortText: `2${fn}`,
                    range,
                })),
            ]
            return { suggestions }
        },
    })
}
