'use client'

import { useState, type ReactNode } from 'react'
import {
    ArrowDown,
    ArrowRight,
    ArrowUp,
    ChevronDown,
    ChevronRight,
    Fingerprint,
    KeyRound,
    Link2,
    Plus,
    Trash2,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button, IconButton } from '@/components/ui/button'
import { Alert } from '@/components/ui/feedback'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import {
    FK_ACTIONS,
    type FkAction,
    type SchemaColumn,
    type SchemaTable,
} from '@/shared/schema/model'
import { DESIGNER_TYPES, defaultSuggestions, parseType } from '@/shared/schema/types'
import type { SchemaIssue } from '@/shared/schema/validate'
import {
    addColumn,
    addRelationship,
    deleteColumn,
    deleteForeignKey,
    deleteTable,
    isColumnUnique,
    moveColumn,
    togglePrimaryKey,
    toggleUnique,
    updateColumn,
    updateForeignKey,
    updateTable,
} from '@/features/designer/operations'
import { useDesigner } from '@/features/designer/store'

/** Text input that commits on blur or Enter and reverts on Escape. */
function CommitInput({
    value,
    onCommit,
    className,
    mono = false,
    placeholder,
    label,
    multiline = false,
}: {
    value: string
    onCommit: (value: string) => void
    className?: string
    mono?: boolean
    placeholder?: string
    label: string
    multiline?: boolean
}) {
    const [draft, setDraft] = useState(value)
    const [source, setSource] = useState(value)
    // An outside change (undo, another field) replaces the local text.
    if (source !== value) {
        setSource(value)
        setDraft(value)
    }
    const commit = () => {
        if (draft !== value) onCommit(draft)
    }
    const props = {
        value: draft,
        'aria-label': label,
        placeholder,
        className: cn('field field-sm', mono && 'mono', className),
        onChange: (event: { target: { value: string } }) => setDraft(event.target.value),
        onBlur: commit,
        onKeyDown: (event: React.KeyboardEvent) => {
            if (event.key === 'Enter' && !multiline) {
                ;(event.target as HTMLElement).blur()
            } else if (event.key === 'Escape') {
                setDraft(value)
                ;(event.target as HTMLElement).blur()
            }
        },
        spellCheck: false,
    }
    return multiline ? <textarea rows={2} {...props} /> : <input {...props} />
}

function Section({
    title,
    children,
    actions,
}: {
    title: string
    children: ReactNode
    actions?: ReactNode
}) {
    return (
        <section className="border-b border-rule px-4 py-3.5">
            <div className="mb-2.5 flex items-center justify-between">
                <h3 className="eyebrow">{title}</h3>
                {actions}
            </div>
            {children}
        </section>
    )
}

export function Inspector({ issues }: { issues: SchemaIssue[] }) {
    const document = useDesigner((state) => state.document)!
    const selection = useDesigner((state) => state.selection)

    if (selection.kind === 'none') return <SchemaSummary issues={issues} />
    const table = document.tables.find((candidate) => candidate.id === selection.tableId)
    if (!table) return <SchemaSummary issues={issues} />
    if (selection.kind === 'relationship') {
        const key = table.foreignKeys.find((candidate) => candidate.id === selection.foreignKeyId)
        if (key) return <RelationshipInspector table={table} foreignKeyId={key.id} />
    }
    return (
        <TableInspector
            table={table}
            focusColumnId={selection.kind === 'table' ? selection.columnId : undefined}
            issues={issues.filter((issue) => issue.tableId === table.id)}
        />
    )
}

function SchemaSummary({ issues }: { issues: SchemaIssue[] }) {
    const document = useDesigner((state) => state.document)!
    const select = useDesigner((state) => state.select)
    const relationships = document.tables.reduce((sum, table) => sum + table.foreignKeys.length, 0)
    const errors = issues.filter((issue) => issue.severity === 'error')
    const warnings = issues.filter((issue) => issue.severity === 'warning')
    return (
        <div>
            <Section title="Schema">
                <dl className="grid grid-cols-2 gap-3 text-[13px]">
                    <div>
                        <dt className="text-ink-3">Tables</dt>
                        <dd className="text-[18px] font-semibold tabular-nums">
                            {document.tables.length}
                        </dd>
                    </div>
                    <div>
                        <dt className="text-ink-3">Relationships</dt>
                        <dd className="text-[18px] font-semibold tabular-nums">{relationships}</dd>
                    </div>
                </dl>
            </Section>
            <Section title={`Checks · ${errors.length} errors, ${warnings.length} warnings`}>
                {issues.length === 0 ? (
                    <p className="text-[12.5px] text-ink-3">No problems found.</p>
                ) : (
                    <ul className="space-y-1.5">
                        {issues.slice(0, 30).map((issue, index) => (
                            <li key={index}>
                                <button
                                    type="button"
                                    onClick={() =>
                                        select({
                                            kind: 'table',
                                            tableId: issue.tableId,
                                            columnId: issue.columnId,
                                        })
                                    }
                                    className="flex w-full items-start gap-2 rounded px-1.5 py-1 text-left text-[12.5px] hover:bg-raised"
                                >
                                    <span
                                        className={cn(
                                            'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
                                            issue.severity === 'error' ? 'bg-danger' : 'bg-warn',
                                        )}
                                    />
                                    <span className="text-ink-2">{issue.message}</span>
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </Section>
            <Section title="Legend">
                <ul className="space-y-1.5 text-[12.5px] text-ink-2">
                    <li className="flex items-center gap-2">
                        <KeyRound size={12} className="text-accent" /> Primary key
                    </li>
                    <li className="flex items-center gap-2">
                        <Link2 size={12} /> Foreign key column
                    </li>
                    <li className="flex items-center gap-2">
                        <Fingerprint size={12} className="text-ink-3" /> Unique
                    </li>
                    <li className="flex items-center gap-2">
                        <span className="font-mono text-[11px] text-ink-3">text?</span> Nullable
                        column
                    </li>
                    <li className="flex items-center gap-2">
                        <svg width="34" height="10" aria-hidden="true">
                            <path d="M1 5h32" stroke="var(--edge-active)" strokeDasharray="5 4" />
                        </svg>
                        Optional relationship (nullable)
                    </li>
                </ul>
            </Section>
            <Section title="How to">
                <ul className="list-disc space-y-1 pl-4 text-[12.5px] text-ink-3">
                    <li>Double-click the canvas, or press T, to add a table.</li>
                    <li>
                        Drag from a column&apos;s dot to another table&apos;s key to create a
                        relationship.
                    </li>
                    <li>Click a table or relationship to edit it here.</li>
                    <li>Changes stay in the draft until you generate and apply a migration.</li>
                </ul>
            </Section>
        </div>
    )
}

function TableInspector({
    table,
    focusColumnId,
    issues,
}: {
    table: SchemaTable
    focusColumnId?: string
    issues: SchemaIssue[]
}) {
    const document = useDesigner((state) => state.document)!
    const apply = useDesigner((state) => state.apply)
    const select = useDesigner((state) => state.select)
    const toast = useToast()
    const [relationTarget, setRelationTarget] = useState('')
    const incoming = document.tables.flatMap((other) =>
        other.foreignKeys
            .filter((key) => key.refTableId === table.id)
            .map((key) => ({ table: other, key })),
    )
    const others = document.tables.filter((candidate) => candidate.id !== table.id)

    return (
        <div>
            <Section
                title="Table"
                actions={
                    <IconButton
                        label="Delete table"
                        size="sm"
                        onClick={() => {
                            apply((doc) => deleteTable(doc, table.id))
                            select({ kind: 'none' })
                        }}
                    >
                        <Trash2 size={14} />
                    </IconButton>
                }
            >
                <div className="space-y-2">
                    <CommitInput
                        label="Table name"
                        mono
                        value={table.name}
                        onCommit={(name) =>
                            apply((doc) => updateTable(doc, table.id, { name: name.trim() }))
                        }
                    />
                    <CommitInput
                        label="Description"
                        multiline
                        placeholder="Description (COMMENT ON TABLE)"
                        value={table.comment ?? ''}
                        onCommit={(comment) =>
                            apply((doc) =>
                                updateTable(doc, table.id, { comment: comment.trim() || null }),
                            )
                        }
                    />
                    <p className="font-mono text-[11px] text-ink-3">
                        schema {table.schema} ·{' '}
                        {table.rowEstimate === null
                            ? 'not in the database yet'
                            : `~${table.rowEstimate} rows`}
                    </p>
                </div>
                {issues.length > 0 ? (
                    <ul className="mt-3 space-y-1.5">
                        {issues.map((issue, index) => (
                            <li key={index}>
                                <Alert
                                    tone={issue.severity === 'error' ? 'error' : 'warning'}
                                    className="py-1.5"
                                >
                                    {issue.message}
                                </Alert>
                            </li>
                        ))}
                    </ul>
                ) : null}
            </Section>

            <Section
                title={`Columns · ${table.columns.length}`}
                actions={
                    <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => {
                            const current = useDesigner.getState().document!
                            const result = addColumn(current, table.id)
                            apply(() => result.document)
                            select({ kind: 'table', tableId: table.id, columnId: result.columnId })
                        }}
                    >
                        <Plus size={13} /> Add
                    </Button>
                }
            >
                <ul className="-mx-1 space-y-1">
                    {table.columns.map((column, index) => (
                        <ColumnEditor
                            key={column.id}
                            table={table}
                            column={column}
                            index={index}
                            open={focusColumnId === column.id}
                            onToggle={() =>
                                select({
                                    kind: 'table',
                                    tableId: table.id,
                                    columnId: focusColumnId === column.id ? undefined : column.id,
                                })
                            }
                        />
                    ))}
                </ul>
            </Section>

            <Section title={`Relationships · ${table.foreignKeys.length}`}>
                {table.foreignKeys.length === 0 ? (
                    <p className="mb-2 text-[12.5px] text-ink-3">
                        This table does not reference other tables.
                    </p>
                ) : (
                    <ul className="mb-3 space-y-1">
                        {table.foreignKeys.map((key) => {
                            const target = document.tables.find(
                                (candidate) => candidate.id === key.refTableId,
                            )
                            const names = key.columns.map(
                                (id) =>
                                    table.columns.find((column) => column.id === id)?.name ?? '?',
                            )
                            const refs = key.refColumns.map(
                                (id) =>
                                    target?.columns.find((column) => column.id === id)?.name ?? '?',
                            )
                            return (
                                <li key={key.id}>
                                    <button
                                        type="button"
                                        onClick={() =>
                                            select({
                                                kind: 'relationship',
                                                tableId: table.id,
                                                foreignKeyId: key.id,
                                            })
                                        }
                                        className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left font-mono text-[12px] hover:bg-raised"
                                    >
                                        <Link2 size={12} className="shrink-0 text-ink-3" />
                                        <span className="truncate">{names.join(', ')}</span>
                                        <ArrowRight size={11} className="shrink-0 text-ink-3" />
                                        <span className="truncate text-ink-2">
                                            {target?.name ?? 'missing'}.{refs.join(', ')}
                                        </span>
                                    </button>
                                </li>
                            )
                        })}
                    </ul>
                )}
                {others.length > 0 ? (
                    <div className="flex gap-2">
                        <select
                            className="field field-sm"
                            value={relationTarget}
                            aria-label="Table to reference"
                            onChange={(event) => setRelationTarget(event.target.value)}
                        >
                            <option value="">Reference a table…</option>
                            {others.map((other) => (
                                <option key={other.id} value={other.id}>
                                    {other.name}
                                </option>
                            ))}
                        </select>
                        <Button
                            size="sm"
                            disabled={!relationTarget}
                            onClick={() => {
                                const current = useDesigner.getState().document!
                                const result = addRelationship(current, table.id, relationTarget)
                                if ('error' in result) {
                                    toast(result.error, 'error')
                                    return
                                }
                                apply(() => result.document)
                                setRelationTarget('')
                                select({
                                    kind: 'relationship',
                                    tableId: table.id,
                                    foreignKeyId: result.foreignKeyId,
                                })
                            }}
                        >
                            Add
                        </Button>
                    </div>
                ) : null}
                <p className="mt-2 text-[11.5px] text-ink-3">
                    Adds a matching column and a foreign key to the table&apos;s primary key.
                </p>
            </Section>

            {incoming.length > 0 ? (
                <Section title={`Referenced by · ${incoming.length}`}>
                    <ul className="space-y-1">
                        {incoming.map(({ table: other, key }) => (
                            <li key={key.id}>
                                <button
                                    type="button"
                                    onClick={() =>
                                        select({
                                            kind: 'relationship',
                                            tableId: other.id,
                                            foreignKeyId: key.id,
                                        })
                                    }
                                    className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left font-mono text-[12px] text-ink-2 hover:bg-raised"
                                >
                                    {other.name}.
                                    {key.columns
                                        .map(
                                            (id) =>
                                                other.columns.find((column) => column.id === id)
                                                    ?.name,
                                        )
                                        .join(', ')}
                                </button>
                            </li>
                        ))}
                    </ul>
                </Section>
            ) : null}

            {table.checks.length > 0 || table.indexes.length > 0 ? (
                <Section title="Preserved, not editable here">
                    <ul className="space-y-1.5">
                        {[
                            ...table.checks.map((check) => ({
                                name: check.name,
                                text: check.definition,
                            })),
                            ...table.indexes.map((index) => ({
                                name: index.name,
                                text: index.definition,
                            })),
                        ].map((item) => (
                            <li
                                key={item.name}
                                className="rounded border border-rule bg-paper px-2 py-1.5"
                            >
                                <p className="font-mono text-[11.5px] text-ink">{item.name}</p>
                                <p className="mt-0.5 font-mono text-[10.5px] break-all text-ink-3">
                                    {item.text}
                                </p>
                            </li>
                        ))}
                    </ul>
                    <p className="mt-2 text-[11.5px] text-ink-3">
                        Check constraints and indexes are kept as they are. Change them from the SQL
                        editor.
                    </p>
                </Section>
            ) : null}
        </div>
    )
}

function TypePicker({ value, onChange }: { value: string; onChange: (type: string) => void }) {
    const parsed = parseType(value)
    const known = parsed.info !== undefined
    const [custom, setCustom] = useState(!known)
    const [source, setSource] = useState(value)
    if (source !== value) {
        setSource(value)
        setCustom(!known)
    }
    const build = (base: string, args: number[], array: boolean) =>
        `${base}${args.length ? `(${args.join(',')})` : ''}${array ? '[]' : ''}`

    if (custom) {
        return (
            <div className="flex gap-1.5">
                <CommitInput
                    label="Custom type"
                    mono
                    value={value}
                    onCommit={(next) => onChange(next.trim() || 'text')}
                />
                <Button size="sm" variant="ghost" onClick={() => setCustom(false)}>
                    List
                </Button>
            </div>
        )
    }
    const info = parsed.info!
    return (
        <div className="space-y-1.5">
            <div className="flex gap-1.5">
                <select
                    className="field field-sm mono"
                    aria-label="Column type"
                    value={parsed.base}
                    onChange={(event) => {
                        if (event.target.value === '__custom') {
                            setCustom(true)
                            return
                        }
                        const next = DESIGNER_TYPES.find(
                            (type) => type.name === event.target.value,
                        )!
                        const args =
                            next.args === 'length'
                                ? [next.name === 'char' ? 1 : 255]
                                : next.args === 'precision-scale'
                                  ? [12, 2]
                                  : []
                        onChange(build(next.name, args, parsed.array))
                    }}
                >
                    {DESIGNER_TYPES.map((type) => (
                        <option key={type.name} value={type.name}>
                            {type.label}
                        </option>
                    ))}
                    <option value="__custom">custom…</option>
                </select>
                <label
                    className="flex shrink-0 items-center gap-1 text-[11.5px] text-ink-3"
                    title="Array of this type"
                >
                    <input
                        type="checkbox"
                        checked={parsed.array}
                        onChange={(event) =>
                            onChange(build(parsed.base, parsed.args, event.target.checked))
                        }
                        className="accent-[var(--accent)]"
                    />
                    []
                </label>
            </div>
            {info.args === 'length' ? (
                <ArgInput
                    label="Length"
                    value={parsed.args[0]}
                    onChange={(length) =>
                        onChange(build(parsed.base, length ? [length] : [], parsed.array))
                    }
                />
            ) : info.args === 'precision-scale' ? (
                <div className="grid grid-cols-2 gap-1.5">
                    <ArgInput
                        label="Precision"
                        value={parsed.args[0]}
                        onChange={(precision) =>
                            onChange(
                                build(
                                    parsed.base,
                                    precision ? [precision, parsed.args[1] ?? 0] : [],
                                    parsed.array,
                                ),
                            )
                        }
                    />
                    <ArgInput
                        label="Scale"
                        value={parsed.args[1]}
                        onChange={(scale) =>
                            onChange(
                                build(
                                    parsed.base,
                                    [parsed.args[0] ?? 12, scale ?? 0],
                                    parsed.array,
                                ),
                            )
                        }
                    />
                </div>
            ) : info.args === 'fractional-seconds' ? (
                <ArgInput
                    label="Fractional digits"
                    value={parsed.args[0]}
                    onChange={(digits) =>
                        onChange(
                            build(parsed.base, digits !== undefined ? [digits] : [], parsed.array),
                        )
                    }
                />
            ) : null}
            <p className="text-[11px] text-ink-3">{info.description}</p>
        </div>
    )
}

function ArgInput({
    label,
    value,
    onChange,
}: {
    label: string
    value: number | undefined
    onChange: (value: number | undefined) => void
}) {
    return (
        <label className="flex items-center gap-2 text-[11.5px] text-ink-3">
            <span className="w-20 shrink-0">{label}</span>
            <CommitInput
                label={label}
                mono
                value={value === undefined ? '' : String(value)}
                placeholder="none"
                onCommit={(next) => {
                    const number = Number.parseInt(next, 10)
                    onChange(Number.isFinite(number) ? number : undefined)
                }}
            />
        </label>
    )
}

function ColumnEditor({
    table,
    column,
    index,
    open,
    onToggle,
}: {
    table: SchemaTable
    column: SchemaColumn
    index: number
    open: boolean
    onToggle: () => void
}) {
    const apply = useDesigner((state) => state.apply)
    const select = useDesigner((state) => state.select)
    const isPk = table.primaryKey?.columns.includes(column.id) ?? false
    const isUnique = isColumnUnique(table, column.id)
    const isFk = table.foreignKeys.some((key) => key.columns.includes(column.id))
    const integer = parseType(column.type).info?.identity === true
    const update = (patch: Partial<SchemaColumn>) =>
        apply((doc) => updateColumn(doc, table.id, column.id, patch))

    return (
        <li className={cn('rounded-md', open && 'border border-rule bg-paper')}>
            <button
                type="button"
                onClick={onToggle}
                aria-expanded={open}
                className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left hover:bg-raised"
            >
                {open ? (
                    <ChevronDown size={12} className="text-ink-3" />
                ) : (
                    <ChevronRight size={12} className="text-ink-3" />
                )}
                <span className="flex w-3.5 justify-center">
                    {isPk ? (
                        <KeyRound size={11} className="text-accent" />
                    ) : isFk ? (
                        <Link2 size={11} className="text-ink-2" />
                    ) : null}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-[12px]">
                    {column.name || 'unnamed'}
                </span>
                <span className="truncate font-mono text-[11px] text-ink-3">
                    {column.type}
                    {column.nullable ? '?' : ''}
                </span>
            </button>
            {open ? (
                <div className="space-y-2.5 px-2.5 pt-1 pb-3">
                    <CommitInput
                        label="Column name"
                        mono
                        value={column.name}
                        onCommit={(name) => update({ name: name.trim() })}
                    />
                    {column.generated ? (
                        <Alert tone="info">
                            Generated column: <span className="font-mono">{column.generated}</span>.
                            Edit it from the SQL editor.
                        </Alert>
                    ) : (
                        <>
                            <TypePicker value={column.type} onChange={(type) => update({ type })} />
                            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12.5px]">
                                <Toggle
                                    checked={isPk}
                                    onChange={() =>
                                        apply((doc) => togglePrimaryKey(doc, table.id, column.id))
                                    }
                                    label="Primary key"
                                />
                                <Toggle
                                    checked={isUnique}
                                    onChange={() =>
                                        apply((doc) => toggleUnique(doc, table.id, column.id))
                                    }
                                    label="Unique"
                                />
                                <Toggle
                                    checked={!column.nullable}
                                    disabled={isPk || Boolean(column.identity)}
                                    onChange={() => update({ nullable: !column.nullable })}
                                    label="Not null"
                                />
                                {integer ? (
                                    <Toggle
                                        checked={Boolean(column.identity)}
                                        onChange={() =>
                                            update({ identity: column.identity ? null : 'always' })
                                        }
                                        label="Identity"
                                    />
                                ) : null}
                            </div>
                            {column.identity ? (
                                <select
                                    className="field field-sm"
                                    aria-label="Identity generation"
                                    value={column.identity}
                                    onChange={(event) =>
                                        update({
                                            identity: event.target.value as 'always' | 'by default',
                                        })
                                    }
                                >
                                    <option value="always">GENERATED ALWAYS</option>
                                    <option value="by default">GENERATED BY DEFAULT</option>
                                </select>
                            ) : (
                                <div>
                                    <CommitInput
                                        label="Default expression"
                                        mono
                                        placeholder="Default (SQL expression)"
                                        value={column.default ?? ''}
                                        onCommit={(value) =>
                                            update({
                                                default: value.trim() === '' ? null : value.trim(),
                                            })
                                        }
                                    />
                                    <div className="mt-1 flex flex-wrap gap-1">
                                        {defaultSuggestions(column.type).map((suggestion) => (
                                            <button
                                                key={suggestion}
                                                type="button"
                                                onClick={() => update({ default: suggestion })}
                                                className="rounded border border-rule px-1.5 py-0.5 font-mono text-[10.5px] text-ink-2 hover:border-rule-strong hover:text-ink"
                                            >
                                                {suggestion}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                    <CommitInput
                        label="Column description"
                        placeholder="Description"
                        value={column.comment ?? ''}
                        onCommit={(comment) => update({ comment: comment.trim() || null })}
                    />
                    <div className="flex items-center justify-between pt-0.5">
                        <div className="flex gap-0.5">
                            <IconButton
                                label="Move up"
                                size="sm"
                                disabled={index === 0}
                                onClick={() =>
                                    apply((doc) => moveColumn(doc, table.id, column.id, -1))
                                }
                            >
                                <ArrowUp size={13} />
                            </IconButton>
                            <IconButton
                                label="Move down"
                                size="sm"
                                disabled={index === table.columns.length - 1}
                                onClick={() =>
                                    apply((doc) => moveColumn(doc, table.id, column.id, 1))
                                }
                            >
                                <ArrowDown size={13} />
                            </IconButton>
                        </div>
                        <Button
                            size="xs"
                            variant="ghost"
                            className="text-danger"
                            onClick={() => {
                                apply((doc) => deleteColumn(doc, table.id, column.id))
                                select({ kind: 'table', tableId: table.id })
                            }}
                        >
                            <Trash2 size={12} /> Delete column
                        </Button>
                    </div>
                    {table.rowEstimate !== null && !column.id.startsWith('n_') ? (
                        <p className="text-[11px] text-ink-3">
                            Reordering only changes the designer; PostgreSQL keeps physical column
                            order.
                        </p>
                    ) : null}
                </div>
            ) : null}
        </li>
    )
}

function Toggle({
    checked,
    onChange,
    label,
    disabled = false,
}: {
    checked: boolean
    onChange: () => void
    label: string
    disabled?: boolean
}) {
    return (
        <label
            className={cn(
                'flex cursor-pointer items-center gap-2',
                disabled && 'cursor-not-allowed opacity-50',
            )}
        >
            <input
                type="checkbox"
                checked={checked}
                onChange={onChange}
                disabled={disabled}
                className="h-3.5 w-3.5 accent-[var(--accent)]"
            />
            {label}
        </label>
    )
}

function RelationshipInspector({
    table,
    foreignKeyId,
}: {
    table: SchemaTable
    foreignKeyId: string
}) {
    const document = useDesigner((state) => state.document)!
    const apply = useDesigner((state) => state.apply)
    const select = useDesigner((state) => state.select)
    const key = table.foreignKeys.find((candidate) => candidate.id === foreignKeyId)!
    const target = document.tables.find((candidate) => candidate.id === key.refTableId)
    const local = key.columns.map((id) => table.columns.find((column) => column.id === id))
    const remote = key.refColumns.map((id) => target?.columns.find((column) => column.id === id))
    const optional = local.some((column) => column?.nullable)

    const action = (label: string, value: FkAction, onChange: (value: FkAction) => void) => (
        <label className="block">
            <span className="mb-1 block text-[12px] text-ink-3">{label}</span>
            <select
                className="field field-sm mono"
                value={value}
                onChange={(event) => onChange(event.target.value as FkAction)}
            >
                {FK_ACTIONS.map((option) => (
                    <option key={option} value={option}>
                        {option}
                    </option>
                ))}
            </select>
        </label>
    )

    return (
        <div>
            <Section
                title="Relationship"
                actions={
                    <IconButton
                        label="Delete relationship"
                        size="sm"
                        onClick={() => {
                            apply((doc) => deleteForeignKey(doc, table.id, key.id))
                            select({ kind: 'table', tableId: table.id })
                        }}
                    >
                        <Trash2 size={14} />
                    </IconButton>
                }
            >
                <div className="rounded-md border border-rule bg-paper p-3 font-mono text-[12px]">
                    <button
                        type="button"
                        className="hover:text-accent"
                        onClick={() => select({ kind: 'table', tableId: table.id })}
                    >
                        {table.name}
                    </button>
                    <span className="text-ink-3">
                        ({local.map((column) => column?.name).join(', ')})
                    </span>
                    <div className="my-1 flex items-center gap-1.5 text-ink-3">
                        <ArrowDown size={12} /> references
                    </div>
                    <button
                        type="button"
                        className="hover:text-accent"
                        onClick={() => target && select({ kind: 'table', tableId: target.id })}
                    >
                        {target?.name ?? 'missing table'}
                    </button>
                    <span className="text-ink-3">
                        ({remote.map((column) => column?.name).join(', ')})
                    </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                    <Badge>{optional ? 'many-to-zero-or-one' : 'many-to-one'}</Badge>
                    {key.name ? (
                        <Badge tone="neutral">{key.name}</Badge>
                    ) : (
                        <Badge tone="ok">new</Badge>
                    )}
                </div>
            </Section>
            <Section title="Referential actions">
                <div className="space-y-2.5">
                    {action('On delete of the referenced row', key.onDelete, (onDelete) =>
                        apply((doc) => updateForeignKey(doc, table.id, key.id, { onDelete })),
                    )}
                    {action('On update of the referenced key', key.onUpdate, (onUpdate) =>
                        apply((doc) => updateForeignKey(doc, table.id, key.id, { onUpdate })),
                    )}
                </div>
                <p className="mt-2.5 text-[11.5px] text-ink-3">
                    CASCADE deletes referencing rows, SET NULL clears the column, RESTRICT and NO
                    ACTION refuse the delete.
                </p>
            </Section>
        </div>
    )
}
