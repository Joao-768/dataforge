'use client'

import { memo } from 'react'
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { AlertTriangle, Fingerprint, KeyRound, Link2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SchemaTable } from '@/shared/schema/model'
import { formatNumber } from '@/lib/format'
import { isColumnUnique } from '@/features/designer/operations'
import { NODE_WIDTH } from '@/features/designer/layout'

export type TableNodeData = {
    table: SchemaTable
    status: 'new' | 'changed' | null
    issue: 'error' | 'warning' | null
    selectedColumnId: string | null
    related: boolean
    onSelectColumn: (tableId: string, columnId: string) => void
}

export type TableFlowNode = Node<TableNodeData, 'table'>

function TableNodeComponent({ data, selected }: NodeProps<TableFlowNode>) {
    const { table, status, issue, selectedColumnId, related, onSelectColumn } = data
    const primary = new Set(table.primaryKey?.columns ?? [])
    const foreign = new Set(table.foreignKeys.flatMap((key) => key.columns))

    return (
        <div
            style={{ width: NODE_WIDTH }}
            className={cn(
                'rounded-md border bg-panel text-[12.5px] shadow-sm transition-[border-color,box-shadow] duration-150',
                selected
                    ? 'border-accent shadow-[0_0_0_1px_var(--accent)]'
                    : issue === 'error'
                      ? 'border-danger/70'
                      : related
                        ? 'border-ink-3'
                        : 'border-rule-strong',
            )}
        >
            <div className="flex items-center gap-2 rounded-t-md border-b border-rule bg-raised/60 px-2.5 py-2">
                <span className="h-2 w-2 shrink-0 rounded-[2px] bg-accent" aria-hidden="true" />
                <span
                    className="min-w-0 flex-1 truncate font-mono text-[12.5px] font-semibold text-ink"
                    title={`${table.schema}.${table.name}`}
                >
                    {table.schema !== 'public' ? (
                        <span className="font-normal text-ink-3">{table.schema}.</span>
                    ) : null}
                    {table.name || <span className="italic text-ink-3">unnamed</span>}
                </span>
                {issue ? (
                    <AlertTriangle
                        size={12}
                        className={issue === 'error' ? 'text-danger' : 'text-warn'}
                        aria-label={issue === 'error' ? 'Has errors' : 'Has warnings'}
                    />
                ) : null}
                {status ? (
                    <span
                        className={cn(
                            'rounded px-1 font-mono text-[9.5px] tracking-[0.06em] uppercase',
                            status === 'new' ? 'bg-ok-soft text-ok' : 'bg-warn-soft text-warn',
                        )}
                    >
                        {status}
                    </span>
                ) : null}
            </div>
            <ul>
                {table.columns.map((column) => {
                    const isPk = primary.has(column.id)
                    const isFk = foreign.has(column.id)
                    const isUnique = isColumnUnique(table, column.id)
                    return (
                        <li
                            key={column.id}
                            className={cn(
                                'relative flex h-[26px] cursor-pointer items-center gap-1.5 px-2.5 hover:bg-raised',
                                selectedColumnId === column.id && 'bg-accent-soft/60',
                            )}
                            onClick={(event) => {
                                event.stopPropagation()
                                onSelectColumn(table.id, column.id)
                            }}
                        >
                            <Handle
                                id={`${column.id}:l`}
                                type="source"
                                position={Position.Left}
                                className="column-handle !-left-[5px]"
                            />
                            <span className="flex w-3.5 shrink-0 justify-center">
                                {isPk ? (
                                    <KeyRound
                                        size={11}
                                        className="text-accent"
                                        aria-label="Primary key"
                                    />
                                ) : isFk ? (
                                    <Link2
                                        size={11}
                                        className="text-ink-2"
                                        aria-label="Foreign key"
                                    />
                                ) : isUnique ? (
                                    <Fingerprint
                                        size={11}
                                        className="text-ink-3"
                                        aria-label="Unique"
                                    />
                                ) : null}
                            </span>
                            <span
                                className={cn(
                                    'min-w-0 flex-1 truncate font-mono text-[12px]',
                                    isPk ? 'text-ink' : 'text-ink-2',
                                )}
                            >
                                {column.name}
                            </span>
                            <span
                                className="shrink-0 truncate font-mono text-[11px] text-ink-3"
                                style={{ maxWidth: 110 }}
                            >
                                {column.type}
                                {column.nullable ? '?' : ''}
                            </span>
                            <Handle
                                id={`${column.id}:r`}
                                type="source"
                                position={Position.Right}
                                className="column-handle !-right-[5px]"
                            />
                        </li>
                    )
                })}
                {table.columns.length === 0 ? (
                    <li className="px-2.5 py-1.5 text-[11.5px] text-ink-3 italic">No columns</li>
                ) : null}
            </ul>
            <div className="flex h-[26px] items-center justify-between rounded-b-md border-t border-rule px-2.5 font-mono text-[10px] text-ink-3">
                <span>{table.columns.length} col</span>
                <span>
                    {table.rowEstimate === null
                        ? status === 'new'
                            ? 'not created yet'
                            : 'rows unknown'
                        : `~${formatNumber(table.rowEstimate)} rows`}
                </span>
            </div>
        </div>
    )
}

export const TableNode = memo(TableNodeComponent)
