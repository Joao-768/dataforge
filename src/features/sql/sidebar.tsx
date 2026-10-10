'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Eye, KeyRound, Search, Table2, Trash2 } from 'lucide-react'
import { IconButton } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { LoadingRows } from '@/components/ui/feedback'
import { useToast } from '@/components/ui/toast'
import { api, ApiError, projectApi } from '@/lib/api'
import { formatDuration, formatRelative } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { LiveSchemaResponse } from '@/features/workspace/queries'

export interface SavedQuery {
    id: string
    name: string
    sql: string
    updatedAt: string
}

export interface HistoryItem {
    id: string
    sql: string
    mode: string
    status: string
    rowCount: number | null
    durationMs: number
    errorMessage: string | null
    source: string
    createdAt: string
}

type Pane = 'schema' | 'saved' | 'history'

export function SqlSidebar({
    projectId,
    schema,
    onInsert,
    onOpen,
}: {
    projectId: string
    schema: LiveSchemaResponse | undefined
    onInsert: (text: string) => void
    onOpen: (tab: { title: string; sql: string; savedQueryId?: string | null }) => void
}) {
    const [pane, setPane] = useState<Pane>('schema')
    return (
        <div className="flex h-full flex-col bg-panel">
            <div
                role="tablist"
                aria-label="Sidebar"
                className="flex h-9 shrink-0 border-b border-rule px-1"
            >
                {(['schema', 'saved', 'history'] as const).map((value) => (
                    <button
                        key={value}
                        role="tab"
                        type="button"
                        aria-selected={pane === value}
                        onClick={() => setPane(value)}
                        className={cn(
                            'relative px-2.5 text-[12.5px] capitalize',
                            pane === value
                                ? 'text-ink after:absolute after:inset-x-2 after:bottom-0 after:h-[2px] after:bg-accent'
                                : 'text-ink-3 hover:text-ink',
                        )}
                    >
                        {value}
                    </button>
                ))}
            </div>
            <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
                {pane === 'schema' ? (
                    <SchemaTree schema={schema} onInsert={onInsert} />
                ) : pane === 'saved' ? (
                    <SavedList projectId={projectId} onOpen={onOpen} />
                ) : (
                    <HistoryList projectId={projectId} onOpen={onOpen} />
                )}
            </div>
        </div>
    )
}

function SchemaTree({
    schema,
    onInsert,
}: {
    schema: LiveSchemaResponse | undefined
    onInsert: (text: string) => void
}) {
    const [filter, setFilter] = useState('')
    const [open, setOpen] = useState<Set<string>>(new Set())
    if (!schema) return <LoadingRows rows={5} />
    const needle = filter.trim().toLowerCase()
    const relations = [
        ...schema.tables.map((table) => ({
            key: table.id,
            name: table.name,
            schema: table.schema,
            kind: 'table' as const,
            primary: new Set(table.primaryKey?.columns ?? []),
            columns: table.columns.map((column) => ({
                id: column.id,
                name: column.name,
                type: column.type,
            })),
        })),
        ...schema.views.map((view) => ({
            key: `${view.schema}.${view.name}`,
            name: view.name,
            schema: view.schema,
            kind: 'view' as const,
            primary: new Set<string>(),
            columns: view.columns.map((column) => ({
                id: column.name,
                name: column.name,
                type: column.type,
            })),
        })),
    ].filter(
        (relation) =>
            !needle ||
            relation.name.toLowerCase().includes(needle) ||
            relation.columns.some((column) => column.name.toLowerCase().includes(needle)),
    )

    return (
        <div className="p-2">
            <label className="relative mb-2 block">
                <Search
                    size={13}
                    className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-ink-3"
                    aria-hidden="true"
                />
                <input
                    value={filter}
                    onChange={(event) => setFilter(event.target.value)}
                    placeholder="Filter tables"
                    aria-label="Filter tables"
                    className="field field-sm pl-7"
                />
            </label>
            <ul>
                {relations.map((relation) => {
                    const expanded = open.has(relation.key) || Boolean(needle)
                    return (
                        <li key={relation.key}>
                            <div className="group flex items-center rounded hover:bg-raised">
                                <button
                                    type="button"
                                    aria-expanded={expanded}
                                    onClick={() =>
                                        setOpen((current) => {
                                            const next = new Set(current)
                                            if (next.has(relation.key)) next.delete(relation.key)
                                            else next.add(relation.key)
                                            return next
                                        })
                                    }
                                    className="flex min-w-0 flex-1 items-center gap-1.5 px-1.5 py-1 text-left"
                                >
                                    {expanded ? (
                                        <ChevronDown size={12} className="text-ink-3" />
                                    ) : (
                                        <ChevronRight size={12} className="text-ink-3" />
                                    )}
                                    {relation.kind === 'view' ? (
                                        <Eye size={12} className="text-ink-3" />
                                    ) : (
                                        <Table2 size={12} className="text-ink-3" />
                                    )}
                                    <span className="truncate font-mono text-[12px]">
                                        {relation.name}
                                    </span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() =>
                                        onInsert(
                                            relation.schema === 'public'
                                                ? relation.name
                                                : `${relation.schema}.${relation.name}`,
                                        )
                                    }
                                    className="mr-1 hidden rounded px-1.5 font-mono text-[10px] text-ink-3 group-hover:block hover:text-accent"
                                    title="Insert name"
                                >
                                    insert
                                </button>
                            </div>
                            {expanded ? (
                                <ul className="mb-1 ml-5 border-l border-rule pl-2">
                                    {relation.columns.map((column) => (
                                        <li key={column.id}>
                                            <button
                                                type="button"
                                                onClick={() => onInsert(column.name)}
                                                className="flex w-full items-center gap-1.5 rounded px-1.5 py-0.5 text-left hover:bg-raised"
                                                title="Insert column name"
                                            >
                                                {relation.primary.has(column.id) ? (
                                                    <KeyRound size={10} className="text-accent" />
                                                ) : (
                                                    <span className="w-2.5" />
                                                )}
                                                <span className="truncate font-mono text-[11.5px] text-ink-2">
                                                    {column.name}
                                                </span>
                                                <span className="ml-auto truncate font-mono text-[10.5px] text-ink-3">
                                                    {column.type}
                                                </span>
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            ) : null}
                        </li>
                    )
                })}
            </ul>
            {relations.length === 0 ? (
                <p className="px-2 py-4 text-[12px] text-ink-3">No tables match.</p>
            ) : null}
        </div>
    )
}

function SavedList({
    projectId,
    onOpen,
}: {
    projectId: string
    onOpen: (tab: { title: string; sql: string; savedQueryId?: string | null }) => void
}) {
    const toast = useToast()
    const queryClient = useQueryClient()
    const { data, isLoading } = useQuery({
        queryKey: ['saved', projectId],
        queryFn: () => api<{ saved: SavedQuery[] }>(projectApi(projectId, '/saved')),
    })
    const remove = useMutation({
        mutationFn: (id: string) =>
            api(projectApi(projectId, `/saved/${id}`), { method: 'DELETE' }),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: ['saved', projectId] })
            toast('Saved query deleted', 'success')
        },
        onError: (error) =>
            toast(error instanceof ApiError ? error.message : 'Could not delete', 'error'),
    })
    if (isLoading) return <LoadingRows rows={4} />
    if (!data?.saved.length) {
        return (
            <p className="p-4 text-[12.5px] text-ink-3">
                No saved queries yet. Press ⌘/Ctrl+S in the editor to save one.
            </p>
        )
    }
    return (
        <ul className="p-1.5">
            {data.saved.map((saved) => (
                <li key={saved.id} className="group flex items-start rounded hover:bg-raised">
                    <button
                        type="button"
                        onClick={() =>
                            onOpen({ title: saved.name, sql: saved.sql, savedQueryId: saved.id })
                        }
                        className="min-w-0 flex-1 px-2 py-1.5 text-left"
                    >
                        <span className="block truncate text-[12.5px]">{saved.name}</span>
                        <span className="block truncate font-mono text-[10.5px] text-ink-3">
                            {saved.sql
                                .replace(/--[^\n]*\n/g, '')
                                .replace(/\s+/g, ' ')
                                .trim()}
                        </span>
                    </button>
                    <IconButton
                        label={`Delete ${saved.name}`}
                        size="sm"
                        className="mt-1 mr-1 opacity-0 group-hover:opacity-100 focus:opacity-100"
                        onClick={() => remove.mutate(saved.id)}
                    >
                        <Trash2 size={12} />
                    </IconButton>
                </li>
            ))}
        </ul>
    )
}

function HistoryList({
    projectId,
    onOpen,
}: {
    projectId: string
    onOpen: (tab: { title: string; sql: string }) => void
}) {
    const { data, isLoading } = useQuery({
        queryKey: ['history', projectId],
        queryFn: () => api<{ history: HistoryItem[] }>(projectApi(projectId, '/history?limit=100')),
    })
    const items = useMemo(() => data?.history ?? [], [data])
    if (isLoading) return <LoadingRows rows={4} />
    if (!items.length)
        return <p className="p-4 text-[12.5px] text-ink-3">Queries you run appear here.</p>
    return (
        <ul className="p-1.5">
            {items.map((item) => (
                <li key={item.id}>
                    <button
                        type="button"
                        onClick={() => onOpen({ title: 'From history', sql: item.sql })}
                        className="w-full rounded px-2 py-1.5 text-left hover:bg-raised"
                    >
                        <span className="flex items-center gap-1.5">
                            <span
                                className={cn(
                                    'h-1.5 w-1.5 shrink-0 rounded-full',
                                    item.status === 'success'
                                        ? 'bg-ok'
                                        : item.status === 'error'
                                          ? 'bg-danger'
                                          : 'bg-warn',
                                )}
                                aria-label={item.status}
                            />
                            <span className="min-w-0 flex-1 truncate font-mono text-[11px]">
                                {item.sql
                                    .replace(/--[^\n]*\n/g, '')
                                    .replace(/\s+/g, ' ')
                                    .trim()}
                            </span>
                        </span>
                        <span className="mt-0.5 flex items-center gap-2 pl-3 font-mono text-[10px] text-ink-3">
                            {item.mode !== 'read' ? (
                                <Badge className="px-1 py-0 text-[9px]">
                                    {item.mode.replace('_', ' ')}
                                </Badge>
                            ) : null}
                            {formatDuration(item.durationMs)}
                            {item.rowCount !== null ? ` · ${item.rowCount} rows` : ''} ·{' '}
                            {formatRelative(item.createdAt)}
                            {item.source !== 'editor' ? ` · ${item.source}` : ''}
                        </span>
                    </button>
                </li>
            ))}
        </ul>
    )
}
