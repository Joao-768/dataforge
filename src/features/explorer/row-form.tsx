'use client'

import { useState, type FormEvent } from 'react'
import { KeyRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Alert } from '@/components/ui/feedback'
import { cn } from '@/lib/utils'
import { typeFamily } from '@/shared/schema/types'

export interface ExplorerColumn {
    name: string
    type: string
    nullable: boolean
    default: string | null
    identity: 'always' | 'by default' | null
    generated: string | null
    comment: string | null
    isPrimaryKey: boolean
}

export type CellInput = { kind: 'value'; value: string } | { kind: 'null' } | { kind: 'default' }

type FieldState = { mode: 'value' | 'null' | 'default'; value: string }

function initialText(value: unknown): string {
    if (value === null || value === undefined) return ''
    if (typeof value === 'object') return JSON.stringify(value, null, 2)
    return String(value)
}

/**
 * Insert or edit one row. Values are sent as text and cast by PostgreSQL to
 * the column's type, so the database's own parsing and constraints decide
 * what is valid; its error message is shown as-is.
 */
export function RowForm({
    open,
    onClose,
    columns,
    row,
    onSubmit,
    error,
}: {
    open: boolean
    onClose: () => void
    columns: ExplorerColumn[]
    /** Existing values when editing; null when inserting. */
    row: unknown[] | null
    onSubmit: (values: Record<string, CellInput>) => Promise<void>
    error: string | null
}) {
    const editing = row !== null
    const initial = (): Record<string, FieldState> =>
        Object.fromEntries(
            columns.map((column, index) => {
                if (editing) {
                    const value = row[index]
                    return [
                        column.name,
                        { mode: value === null ? 'null' : 'value', value: initialText(value) },
                    ]
                }
                const useDefault = Boolean(
                    column.default !== null || column.identity || column.generated,
                )
                return [
                    column.name,
                    {
                        mode: useDefault ? 'default' : column.nullable ? 'null' : 'value',
                        value: '',
                    },
                ]
            }),
        )
    const [fields, setFields] = useState<Record<string, FieldState>>(initial)
    const [busy, setBusy] = useState(false)
    const [lastOpen, setLastOpen] = useState(open)
    if (open !== lastOpen) {
        setLastOpen(open)
        if (open) setFields(initial())
    }

    const set = (name: string, patch: Partial<FieldState>) =>
        setFields((current) => ({ ...current, [name]: { ...current[name]!, ...patch } }))

    async function submit(event: FormEvent) {
        event.preventDefault()
        const values: Record<string, CellInput> = {}
        columns.forEach((column, index) => {
            const field = fields[column.name]!
            if (column.generated) return
            if (editing) {
                const before = row[index]
                const unchanged =
                    (field.mode === 'null' && before === null) ||
                    (field.mode === 'value' &&
                        before !== null &&
                        initialText(before) === field.value)
                if (unchanged) return
            }
            values[column.name] =
                field.mode === 'value'
                    ? { kind: 'value', value: field.value }
                    : { kind: field.mode }
        })
        setBusy(true)
        try {
            await onSubmit(values)
        } finally {
            setBusy(false)
        }
    }

    return (
        <Dialog
            open={open}
            onClose={onClose}
            size="lg"
            title={editing ? 'Edit row' : 'Insert row'}
            description={
                editing
                    ? 'Only changed columns are updated. The row is matched by its primary key.'
                    : 'Columns left on DEFAULT get their database default.'
            }
        >
            <form onSubmit={submit} className="space-y-3">
                {error ? <Alert>{error}</Alert> : null}
                <div className="rows rounded-md border border-rule">
                    {columns.map((column) => {
                        const field = fields[column.name]!
                        const family = typeFamily(column.type)
                        const locked =
                            Boolean(column.generated) ||
                            (column.identity === 'always' && !editing) ||
                            (editing && column.identity === 'always')
                        return (
                            <div
                                key={column.name}
                                className="grid gap-2 px-3 py-2.5 sm:grid-cols-[11rem_minmax(0,1fr)]"
                            >
                                <div className="min-w-0">
                                    <p className="flex items-center gap-1.5 font-mono text-[12.5px]">
                                        {column.isPrimaryKey ? (
                                            <KeyRound size={11} className="text-accent" />
                                        ) : null}
                                        <span className="truncate">{column.name}</span>
                                    </p>
                                    <p className="font-mono text-[10.5px] text-ink-3">
                                        {column.type}
                                        {column.nullable ? '' : ' · not null'}
                                    </p>
                                </div>
                                <div className="min-w-0">
                                    {locked ? (
                                        <p className="py-1.5 text-[12px] text-ink-3">
                                            {column.generated
                                                ? 'Generated by the database'
                                                : 'Generated by the identity sequence'}
                                        </p>
                                    ) : (
                                        <>
                                            <div className="mb-1.5 flex gap-1">
                                                {(editing
                                                    ? (['value', 'null'] as const)
                                                    : (['value', 'null', 'default'] as const)
                                                ).map((mode) => {
                                                    const disabled =
                                                        (mode === 'null' && !column.nullable) ||
                                                        (mode === 'default' &&
                                                            column.default === null &&
                                                            !column.identity)
                                                    return (
                                                        <button
                                                            key={mode}
                                                            type="button"
                                                            disabled={disabled}
                                                            onClick={() =>
                                                                set(column.name, { mode })
                                                            }
                                                            className={cn(
                                                                'rounded border px-1.5 py-0.5 font-mono text-[10.5px] uppercase disabled:opacity-30',
                                                                field.mode === mode
                                                                    ? 'border-accent bg-accent-soft text-accent-text'
                                                                    : 'border-rule text-ink-3 hover:text-ink',
                                                            )}
                                                        >
                                                            {mode}
                                                        </button>
                                                    )
                                                })}
                                                {field.mode === 'default' && column.default ? (
                                                    <span className="truncate self-center font-mono text-[10.5px] text-ink-3">
                                                        {column.default}
                                                    </span>
                                                ) : null}
                                            </div>
                                            {field.mode === 'value' ? (
                                                family === 'boolean' ? (
                                                    <select
                                                        className="field field-sm mono"
                                                        value={field.value}
                                                        onChange={(event) =>
                                                            set(column.name, {
                                                                value: event.target.value,
                                                            })
                                                        }
                                                        aria-label={column.name}
                                                    >
                                                        <option value="">choose…</option>
                                                        <option value="true">true</option>
                                                        <option value="false">false</option>
                                                    </select>
                                                ) : family === 'json' ||
                                                  (family === 'text' && field.value.length > 60) ? (
                                                    <textarea
                                                        className="field mono"
                                                        rows={family === 'json' ? 5 : 3}
                                                        value={field.value}
                                                        onChange={(event) =>
                                                            set(column.name, {
                                                                value: event.target.value,
                                                            })
                                                        }
                                                        aria-label={column.name}
                                                        spellCheck={false}
                                                    />
                                                ) : (
                                                    <input
                                                        className="field field-sm mono"
                                                        value={field.value}
                                                        onChange={(event) =>
                                                            set(column.name, {
                                                                value: event.target.value,
                                                            })
                                                        }
                                                        aria-label={column.name}
                                                        inputMode={
                                                            family === 'integer' ||
                                                            family === 'decimal' ||
                                                            family === 'float'
                                                                ? 'decimal'
                                                                : undefined
                                                        }
                                                        placeholder={
                                                            family === 'datetime'
                                                                ? '2026-01-31 14:00:00+00'
                                                                : family === 'uuid'
                                                                  ? 'uuid'
                                                                  : undefined
                                                        }
                                                        spellCheck={false}
                                                    />
                                                )
                                            ) : null}
                                        </>
                                    )}
                                </div>
                            </div>
                        )
                    })}
                </div>
                <div className="flex justify-end gap-2 pt-1">
                    <Button variant="ghost" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button type="submit" variant="primary" busy={busy}>
                        {editing ? 'Save changes' : 'Insert row'}
                    </Button>
                </div>
            </form>
        </Dialog>
    )
}
