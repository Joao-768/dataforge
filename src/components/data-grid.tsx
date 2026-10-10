'use client'

import { useMemo, useRef, useState, type ReactNode } from 'react'
import {
    getCoreRowModel,
    useReactTable,
    type ColumnDef,
    type ColumnSizingState,
} from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDown, ArrowUp, ArrowUpDown, Copy } from 'lucide-react'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'

// Result grid shared by the SQL editor and the data explorer: TanStack Table
// for the column model (widths, resizing), TanStack Virtual for rows, so a
// thousand-row result renders only what is on screen.

export interface GridColumn {
    name: string
    type: string
    isPrimaryKey?: boolean
}

const NUMERIC = /^(smallint|integer|bigint|numeric|real|double precision|money|oid)/

export function displayValue(value: unknown): string {
    if (value === null || value === undefined) return 'NULL'
    if (typeof value === 'object') return JSON.stringify(value)
    return String(value)
}

/** Text for copying a value: JSON stays JSON, NULL becomes empty. */
export function copyText(value: unknown): string {
    if (value === null || value === undefined) return ''
    if (typeof value === 'object') return JSON.stringify(value, null, 2)
    return String(value)
}

export function Cell({ value, type }: { value: unknown; type: string }) {
    if (value === null || value === undefined) {
        return <span className="font-mono text-[11px] text-ink-3 italic">NULL</span>
    }
    if (typeof value === 'boolean') {
        return (
            <span className={cn('font-mono', value ? 'text-ok' : 'text-ink-3')}>
                {String(value)}
            </span>
        )
    }
    if (typeof value === 'object') {
        return <span className="font-mono text-[11.5px] text-ink-2">{JSON.stringify(value)}</span>
    }
    if (typeof value === 'number' || NUMERIC.test(type)) {
        return <span className="font-mono tabular-nums">{String(value)}</span>
    }
    if (/^(date|time|timestamp|interval|uuid)/.test(type)) {
        return <span className="font-mono text-[11.5px]">{String(value)}</span>
    }
    return <>{String(value)}</>
}

export interface DataGridProps {
    columns: GridColumn[]
    rows: unknown[][]
    /** Show a leading row-number column (offset for pagination). */
    rowNumberOffset?: number
    selectable?: boolean
    selected?: Set<number>
    onSelectedChange?: (selected: Set<number>) => void
    onRowOpen?: (rowIndex: number) => void
    sort?: { column: string; direction: 'asc' | 'desc' } | null
    onSort?: (column: string) => void
    headerExtra?: (column: GridColumn) => ReactNode
    className?: string
    emptyMessage?: string
}

const ROW_HEIGHT = 30

export function DataGrid({
    columns,
    rows,
    rowNumberOffset = 0,
    selectable = false,
    selected,
    onSelectedChange,
    onRowOpen,
    sort,
    onSort,
    headerExtra,
    className,
    emptyMessage = 'No rows',
}: DataGridProps) {
    const toast = useToast()
    const parentRef = useRef<HTMLDivElement>(null)
    const [sizing, setSizing] = useState<ColumnSizingState>({})
    const [active, setActive] = useState<{ row: number; column: number } | null>(null)

    const definitions = useMemo<ColumnDef<unknown[]>[]>(
        () =>
            columns.map((column, index) => ({
                id: `${index}:${column.name}`,
                header: column.name,
                accessorFn: (row) => row[index],
                size: Math.min(
                    320,
                    Math.max(
                        90,
                        column.name.length * 9 + 50,
                        /json|text|timestamp/.test(column.type) ? 210 : 120,
                    ),
                ),
                minSize: 60,
                maxSize: 900,
            })),
        [columns],
    )

    const table = useReactTable({
        data: rows,
        columns: definitions,
        getCoreRowModel: getCoreRowModel(),
        columnResizeMode: 'onChange',
        state: { columnSizing: sizing },
        onColumnSizingChange: setSizing,
    })

    const virtualizer = useVirtualizer({
        count: rows.length,
        getScrollElement: () => parentRef.current,
        estimateSize: () => ROW_HEIGHT,
        overscan: 12,
    })

    const leading = (selectable ? 32 : 0) + 52
    const totalWidth = leading + table.getTotalSize()
    const allSelected = selectable && rows.length > 0 && selected?.size === rows.length

    const copy = async (value: unknown) => {
        try {
            await navigator.clipboard.writeText(copyText(value))
            toast('Copied to clipboard', 'success')
        } catch {
            toast('Clipboard is not available', 'error')
        }
    }

    const onKeyDown = (event: React.KeyboardEvent) => {
        if (!active) return
        const move = (row: number, column: number) => {
            const next = {
                row: Math.max(0, Math.min(rows.length - 1, row)),
                column: Math.max(0, Math.min(columns.length - 1, column)),
            }
            setActive(next)
            virtualizer.scrollToIndex(next.row)
            event.preventDefault()
        }
        if (event.key === 'ArrowDown') move(active.row + 1, active.column)
        else if (event.key === 'ArrowUp') move(active.row - 1, active.column)
        else if (event.key === 'ArrowRight') move(active.row, active.column + 1)
        else if (event.key === 'ArrowLeft') move(active.row, active.column - 1)
        else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c') {
            event.preventDefault()
            void copy(rows[active.row]?.[active.column])
        } else if (event.key === 'Enter' && onRowOpen) {
            onRowOpen(active.row)
        }
    }

    if (columns.length === 0) {
        return (
            <div className="flex h-full items-center justify-center p-6 text-[13px] text-ink-3">
                {emptyMessage}
            </div>
        )
    }

    return (
        <div
            ref={parentRef}
            tabIndex={0}
            onKeyDown={onKeyDown}
            role="grid"
            aria-rowcount={rows.length}
            aria-colcount={columns.length}
            className={cn(
                'scrollbar-thin relative h-full overflow-auto text-[12.5px] outline-none',
                className,
            )}
        >
            <div style={{ width: totalWidth, minWidth: '100%' }}>
                <div
                    role="row"
                    className="sticky top-0 z-10 flex border-b border-rule bg-panel"
                    style={{ height: 34 }}
                >
                    {selectable ? (
                        <div className="flex w-8 shrink-0 items-center justify-center border-r border-rule">
                            <input
                                type="checkbox"
                                aria-label="Select all rows"
                                checked={allSelected}
                                onChange={() =>
                                    onSelectedChange?.(
                                        allSelected
                                            ? new Set()
                                            : new Set(rows.map((_, index) => index)),
                                    )
                                }
                                className="h-3.5 w-3.5 accent-[var(--accent)]"
                            />
                        </div>
                    ) : null}
                    <div className="flex w-[52px] shrink-0 items-center justify-end border-r border-rule pr-2 font-mono text-[10.5px] text-ink-3">
                        #
                    </div>
                    {table.getHeaderGroups()[0]!.headers.map((header, index) => {
                        const column = columns[index]!
                        const sorted = sort?.column === column.name ? sort.direction : null
                        return (
                            <div
                                key={header.id}
                                role="columnheader"
                                aria-sort={
                                    sorted === 'asc'
                                        ? 'ascending'
                                        : sorted === 'desc'
                                          ? 'descending'
                                          : undefined
                                }
                                className="group relative flex shrink-0 items-center gap-1 border-r border-rule px-2"
                                style={{ width: header.getSize() }}
                            >
                                <button
                                    type="button"
                                    disabled={!onSort}
                                    onClick={() => onSort?.(column.name)}
                                    className="flex min-w-0 flex-1 items-center gap-1.5 text-left disabled:cursor-default"
                                    title={`${column.name} · ${column.type}`}
                                >
                                    <span
                                        className={cn(
                                            'truncate font-mono text-[12px] font-medium',
                                            column.isPrimaryKey && 'text-accent',
                                        )}
                                    >
                                        {column.name}
                                    </span>
                                    <span className="truncate font-mono text-[10px] text-ink-3">
                                        {column.type}
                                    </span>
                                    {onSort ? (
                                        sorted === 'asc' ? (
                                            <ArrowUp size={11} className="shrink-0 text-accent" />
                                        ) : sorted === 'desc' ? (
                                            <ArrowDown size={11} className="shrink-0 text-accent" />
                                        ) : (
                                            <ArrowUpDown
                                                size={11}
                                                className="shrink-0 text-ink-3 opacity-0 group-hover:opacity-100"
                                            />
                                        )
                                    ) : null}
                                </button>
                                {headerExtra?.(column)}
                                <div
                                    onMouseDown={header.getResizeHandler()}
                                    onTouchStart={header.getResizeHandler()}
                                    onDoubleClick={() => header.column.resetSize()}
                                    role="separator"
                                    aria-label={`Resize ${column.name}`}
                                    className={cn(
                                        'absolute top-0 right-0 h-full w-1 cursor-col-resize select-none hover:bg-accent',
                                        header.column.getIsResizing() && 'bg-accent',
                                    )}
                                />
                            </div>
                        )
                    })}
                </div>
                {rows.length === 0 ? (
                    <div className="px-4 py-8 text-center text-[13px] text-ink-3">
                        {emptyMessage}
                    </div>
                ) : (
                    <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
                        {virtualizer.getVirtualItems().map((item) => {
                            const row = table.getRowModel().rows[item.index]!
                            const isSelected = selected?.has(item.index) ?? false
                            return (
                                <div
                                    key={item.key}
                                    role="row"
                                    aria-rowindex={item.index + 1}
                                    aria-selected={isSelected || undefined}
                                    onDoubleClick={() => onRowOpen?.(item.index)}
                                    className={cn(
                                        'absolute left-0 flex w-full border-b border-rule/70 select-none hover:bg-raised/70',
                                        isSelected && 'bg-accent-soft/50 hover:bg-accent-soft/70',
                                    )}
                                    style={{
                                        height: ROW_HEIGHT,
                                        transform: `translateY(${item.start}px)`,
                                    }}
                                >
                                    {selectable ? (
                                        <div className="flex w-8 shrink-0 items-center justify-center border-r border-rule/70">
                                            <input
                                                type="checkbox"
                                                aria-label={`Select row ${item.index + 1}`}
                                                checked={isSelected}
                                                onChange={() => {
                                                    const next = new Set(selected)
                                                    if (next.has(item.index))
                                                        next.delete(item.index)
                                                    else next.add(item.index)
                                                    onSelectedChange?.(next)
                                                }}
                                                className="h-3.5 w-3.5 accent-[var(--accent)]"
                                            />
                                        </div>
                                    ) : null}
                                    <div className="flex w-[52px] shrink-0 items-center justify-end border-r border-rule/70 pr-2 font-mono text-[10.5px] text-ink-3">
                                        {rowNumberOffset + item.index + 1}
                                    </div>
                                    {row.getVisibleCells().map((cell, index) => {
                                        const value = cell.getValue()
                                        const isActive =
                                            active?.row === item.index && active.column === index
                                        return (
                                            <div
                                                key={cell.id}
                                                role="gridcell"
                                                onClick={() =>
                                                    setActive({ row: item.index, column: index })
                                                }
                                                className={cn(
                                                    'group/cell relative flex shrink-0 items-center overflow-hidden border-r border-rule/70 px-2 whitespace-nowrap',
                                                    isActive &&
                                                        'outline outline-1 -outline-offset-1 outline-accent',
                                                    NUMERIC.test(columns[index]!.type) &&
                                                        'justify-end',
                                                )}
                                                style={{ width: cell.column.getSize() }}
                                                title={displayValue(value).slice(0, 500)}
                                            >
                                                <span className="truncate">
                                                    <Cell
                                                        value={value}
                                                        type={columns[index]!.type}
                                                    />
                                                </span>
                                                {isActive ? (
                                                    <button
                                                        type="button"
                                                        aria-label="Copy value"
                                                        onClick={(event) => {
                                                            event.stopPropagation()
                                                            void copy(value)
                                                        }}
                                                        className="absolute right-0.5 rounded bg-panel p-1 text-ink-3 hover:text-ink"
                                                    >
                                                        <Copy size={11} />
                                                    </button>
                                                ) : null}
                                            </div>
                                        )
                                    })}
                                </div>
                            )
                        })}
                    </div>
                )}
            </div>
        </div>
    )
}

/** CSV for a set of rows, RFC 4180 quoting. */
export function toCsv(columns: GridColumn[], rows: unknown[][]): string {
    const escape = (value: unknown) => {
        const text =
            value === null || value === undefined
                ? ''
                : typeof value === 'object'
                  ? JSON.stringify(value)
                  : String(value)
        return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
    }
    return (
        [
            columns.map((column) => escape(column.name)).join(','),
            ...rows.map((row) => row.map(escape).join(',')),
        ].join('\r\n') + '\r\n'
    )
}

export function downloadText(filename: string, text: string, type = 'text/csv') {
    const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }))
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
