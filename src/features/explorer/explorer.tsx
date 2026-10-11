'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels'
import {
    ChevronLeft,
    ChevronRight,
    Copy,
    Download,
    Eye,
    Filter,
    KeyRound,
    Lock,
    PenLine,
    Plus,
    RefreshCw,
    Search,
    Table2,
    Trash2,
    X,
} from 'lucide-react'
import { copyText, DataGrid, displayValue, downloadText, toCsv } from '@/components/data-grid'
import { Badge } from '@/components/ui/badge'
import { Button, IconButton } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/dialog'
import { Alert, EmptyState, LoadingRows } from '@/components/ui/feedback'
import { Menu } from '@/components/ui/menu'
import { useToast } from '@/components/ui/toast'
import { api, ApiError, projectApi } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import { useMediaQuery } from '@/lib/use-media-query'
import { cn } from '@/lib/utils'
import { useProjectId } from '@/features/workspace/context'
import { useLiveSchema } from '@/features/workspace/queries'
import { RowForm, type CellInput, type ExplorerColumn } from '@/features/explorer/row-form'

const OPERATORS = [
    { value: 'eq', label: '=' },
    { value: 'neq', label: '≠' },
    { value: 'lt', label: '<' },
    { value: 'lte', label: '≤' },
    { value: 'gt', label: '>' },
    { value: 'gte', label: '≥' },
    { value: 'contains', label: 'contains' },
    { value: 'starts_with', label: 'starts with' },
    { value: 'is_null', label: 'is null' },
    { value: 'not_null', label: 'is not null' },
] as const

type Operator = (typeof OPERATORS)[number]['value']

interface FilterRule {
    column: string
    op: Operator
    value?: string
}

interface BrowseResponse {
    table: { schema: string; name: string; kind: 'table' | 'view' }
    columns: ExplorerColumn[]
    primaryKey: string[] | null
    rows: unknown[][]
    page: number
    pageSize: number
    total: number | null
    totalCapped: boolean
    editable: boolean
    readOnlyReason: string | null
}

export function DataExplorer() {
    const projectId = useProjectId()
    const router = useRouter()
    const pathname = usePathname()
    const params = useSearchParams()
    const schema = useLiveSchema(projectId)
    // The table list is a side panel from tablet width up, a select above the grid otherwise.
    const wide = useMediaQuery('(min-width: 768px)')
    const layout = useDefaultLayout({
        id: 'dataforge:explorer',
        panelIds: wide ? ['tables', 'grid'] : ['grid'],
    })
    const [filterText, setFilterText] = useState('')

    const relations = useMemo(
        () => [
            ...(schema.data?.tables ?? []).map((table) => ({
                schema: table.schema,
                name: table.name,
                kind: 'table' as const,
                rows: table.rowEstimate,
            })),
            ...(schema.data?.views ?? []).map((view) => ({
                schema: view.schema,
                name: view.name,
                kind: 'view' as const,
                rows: null,
            })),
        ],
        [schema.data],
    )
    const selectedSchema = params.get('schema')
    const selectedTable = params.get('table')
    const current = relations.find(
        (relation) => relation.schema === selectedSchema && relation.name === selectedTable,
    )

    // Default to the first table.
    useEffect(() => {
        if (!current && relations[0] && !selectedTable) {
            router.replace(
                `${pathname}?schema=${encodeURIComponent(relations[0].schema)}&table=${encodeURIComponent(relations[0].name)}`,
            )
        }
    }, [current, relations, selectedTable, pathname, router])

    const choose = (relation: { schema: string; name: string }) =>
        router.push(
            `${pathname}?schema=${encodeURIComponent(relation.schema)}&table=${encodeURIComponent(relation.name)}`,
        )

    if (schema.isLoading) return <LoadingRows rows={8} />
    if (schema.error)
        return (
            <div className="p-6">
                <Alert>{(schema.error as Error).message}</Alert>
            </div>
        )
    if (relations.length === 0) {
        return (
            <EmptyState
                className="blueprint flex-1"
                icon={<Table2 size={18} />}
                title="No tables yet"
            >
                Create tables in the schema designer or the SQL editor, then browse them here.
            </EmptyState>
        )
    }

    const needle = filterText.trim().toLowerCase()
    return (
        <div className="h-[calc(100svh-var(--masthead-height)-var(--tabs-height)-44px)] min-h-[520px]">
            <Group
                orientation="horizontal"
                className="h-full"
                defaultLayout={layout.defaultLayout}
                onLayoutChanged={layout.onLayoutChanged}
            >
                {wide ? (
                    <Panel
                        id="tables"
                        defaultSize="16"
                        minSize="12"
                        maxSize="30"
                        className="bg-panel"
                    >
                        <nav aria-label="Tables" className="flex h-full flex-col">
                            <div className="border-b border-rule p-2">
                                <label className="relative block">
                                    <Search
                                        size={13}
                                        className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-ink-3"
                                        aria-hidden="true"
                                    />
                                    <input
                                        value={filterText}
                                        onChange={(event) => setFilterText(event.target.value)}
                                        placeholder="Find a table"
                                        aria-label="Find a table"
                                        className="field field-sm pl-7"
                                    />
                                </label>
                            </div>
                            <ul className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-1.5">
                                {relations
                                    .filter(
                                        (relation) =>
                                            !needle || relation.name.toLowerCase().includes(needle),
                                    )
                                    .map((relation) => {
                                        const active = relation === current
                                        return (
                                            <li key={`${relation.schema}.${relation.name}`}>
                                                <button
                                                    type="button"
                                                    onClick={() => choose(relation)}
                                                    aria-current={active ? 'true' : undefined}
                                                    className={cn(
                                                        'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left',
                                                        active
                                                            ? 'bg-raised text-ink'
                                                            : 'text-ink-2 hover:bg-raised/60 hover:text-ink',
                                                    )}
                                                >
                                                    {relation.kind === 'view' ? (
                                                        <Eye
                                                            size={12}
                                                            className="shrink-0 text-ink-3"
                                                        />
                                                    ) : (
                                                        <Table2
                                                            size={12}
                                                            className={cn(
                                                                'shrink-0',
                                                                active
                                                                    ? 'text-accent'
                                                                    : 'text-ink-3',
                                                            )}
                                                        />
                                                    )}
                                                    <span className="min-w-0 flex-1 truncate font-mono text-[12px]">
                                                        {relation.schema !== 'public'
                                                            ? `${relation.schema}.`
                                                            : ''}
                                                        {relation.name}
                                                    </span>
                                                    {relation.rows !== null ? (
                                                        <span className="font-mono text-[10px] text-ink-3">
                                                            {formatNumber(relation.rows)}
                                                        </span>
                                                    ) : null}
                                                </button>
                                            </li>
                                        )
                                    })}
                            </ul>
                        </nav>
                    </Panel>
                ) : null}
                {wide ? <Separator /> : null}
                <Panel id="grid" minSize="40">
                    {!wide ? (
                        <div className="border-b border-rule p-2">
                            <select
                                className="field field-sm mono"
                                aria-label="Table"
                                value={current ? `${current.schema}.${current.name}` : ''}
                                onChange={(event) => {
                                    const relation = relations.find(
                                        (candidate) =>
                                            `${candidate.schema}.${candidate.name}` ===
                                            event.target.value,
                                    )
                                    if (relation) choose(relation)
                                }}
                            >
                                {relations.map((relation) => (
                                    <option
                                        key={`${relation.schema}.${relation.name}`}
                                        value={`${relation.schema}.${relation.name}`}
                                    >
                                        {relation.schema === 'public'
                                            ? relation.name
                                            : `${relation.schema}.${relation.name}`}
                                    </option>
                                ))}
                            </select>
                        </div>
                    ) : null}
                    {current ? (
                        <TableView
                            key={`${current.schema}.${current.name}`}
                            schemaName={current.schema}
                            tableName={current.name}
                        />
                    ) : (
                        <LoadingRows rows={6} />
                    )}
                </Panel>
            </Group>
        </div>
    )
}

function TableView({ schemaName, tableName }: { schemaName: string; tableName: string }) {
    const projectId = useProjectId()
    const toast = useToast()
    const queryClient = useQueryClient()
    const [page, setPage] = useState(1)
    const [pageSize, setPageSize] = useState(50)
    const [sort, setSort] = useState<{ column: string; direction: 'asc' | 'desc' } | null>(null)
    const [search, setSearch] = useState('')
    const [debouncedSearch, setDebouncedSearch] = useState('')
    const [filters, setFilters] = useState<FilterRule[]>([])
    const [draftFilter, setDraftFilter] = useState<FilterRule | null>(null)
    const [selected, setSelected] = useState<Set<number>>(new Set())
    const [inspected, setInspected] = useState<number | null>(null)
    const [panel, setPanel] = useState<'row' | 'columns'>('row')
    const [form, setForm] = useState<{ row: unknown[] | null } | null>(null)
    const [formError, setFormError] = useState<string | null>(null)
    const [deleting, setDeleting] = useState(false)
    const [deleteBusy, setDeleteBusy] = useState(false)

    useEffect(() => {
        const timer = window.setTimeout(() => {
            setDebouncedSearch(search)
            setPage(1)
        }, 300)
        return () => window.clearTimeout(timer)
    }, [search])

    const query = new URLSearchParams({
        schema: schemaName,
        table: tableName,
        page: String(page),
        pageSize: String(pageSize),
        direction: sort?.direction ?? 'asc',
        ...(sort ? { sort: sort.column } : {}),
        ...(debouncedSearch ? { search: debouncedSearch } : {}),
        ...(filters.length ? { filters: JSON.stringify(filters) } : {}),
    })
    const key = ['data', projectId, schemaName, tableName, query.toString()]
    const { data, error, isFetching, refetch } = useQuery({
        queryKey: key,
        queryFn: () => api<BrowseResponse>(projectApi(projectId, `/data?${query}`)),
        placeholderData: keepPreviousData,
    })

    // A new page of rows clears the selection and the inspected row.
    const [rowsSeen, setRowsSeen] = useState(data?.rows)
    if (rowsSeen !== data?.rows) {
        setRowsSeen(data?.rows)
        setSelected(new Set())
        setInspected(null)
    }

    const columns = data?.columns ?? []
    const pages =
        data?.total !== null && data?.total !== undefined
            ? Math.max(1, Math.ceil(data.total / pageSize))
            : null
    const keyOf = (row: unknown[]) =>
        Object.fromEntries(
            (data?.primaryKey ?? []).map((name) => [
                name,
                row[columns.findIndex((column) => column.name === name)] as
                    string | number | boolean | null,
            ]),
        )

    const refresh = async () => {
        await queryClient.invalidateQueries({
            queryKey: ['data', projectId, schemaName, tableName],
        })
        void queryClient.invalidateQueries({ queryKey: ['schema', projectId] })
    }

    async function saveRow(values: Record<string, CellInput>) {
        setFormError(null)
        try {
            if (form?.row) {
                if (Object.keys(values).length === 0) {
                    setForm(null)
                    return
                }
                await api(projectApi(projectId, '/data/rows'), {
                    method: 'PATCH',
                    body: {
                        schema: schemaName,
                        table: tableName,
                        key: keyOf(form.row),
                        changes: values,
                    },
                })
                toast('Row updated', 'success')
            } else {
                await api(projectApi(projectId, '/data/rows'), {
                    body: { schema: schemaName, table: tableName, values },
                })
                toast('Row inserted', 'success')
            }
            setForm(null)
            await refresh()
        } catch (caught) {
            const details =
                caught instanceof ApiError ? (caught.details as { detail?: string } | null) : null
            setFormError(
                caught instanceof ApiError
                    ? `${caught.message}${details?.detail ? `. ${details.detail}` : ''}`
                    : 'Could not save the row.',
            )
        }
    }

    async function deleteSelected() {
        if (!data) return
        setDeleteBusy(true)
        try {
            const keys = [...selected].map((index) => keyOf(data.rows[index]!))
            const result = await api<{ rowCount: number }>(projectApi(projectId, '/data/rows'), {
                method: 'DELETE',
                body: { schema: schemaName, table: tableName, keys },
            })
            toast(`Deleted ${result.rowCount} row${result.rowCount === 1 ? '' : 's'}`, 'success')
            setDeleting(false)
            await refresh()
        } catch (caught) {
            toast(
                caught instanceof ApiError ? caught.message : 'Could not delete the rows.',
                'error',
            )
        } finally {
            setDeleteBusy(false)
        }
    }

    const exportUrl = (format: 'csv' | 'sql') =>
        projectApi(
            projectId,
            `/export/table?schema=${encodeURIComponent(schemaName)}&table=${encodeURIComponent(tableName)}&format=${format}`,
        )

    const inspectedRow = inspected !== null ? data?.rows[inspected] : undefined

    return (
        <div className="flex h-full">
            <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex min-h-11 flex-wrap items-center gap-2 border-b border-rule px-3 py-1.5">
                    <h1 className="flex items-center gap-2 font-mono text-[13px] font-semibold">
                        {data?.table.kind === 'view' ? (
                            <Eye size={13} className="text-ink-3" />
                        ) : (
                            <Table2 size={13} className="text-accent" />
                        )}
                        {schemaName !== 'public' ? `${schemaName}.` : ''}
                        {tableName}
                    </h1>
                    {data ? (
                        <span className="font-mono text-[11px] text-ink-3">
                            {data.total === null
                                ? 'many rows'
                                : `${formatNumber(data.total)}${data.totalCapped ? '+' : ''} row${data.total === 1 ? '' : 's'}${data.totalCapped ? ' (estimate)' : ''}`}
                        </span>
                    ) : null}
                    {data && !data.editable ? (
                        <Badge className="gap-1" tone="neutral">
                            <Lock size={10} /> read-only
                        </Badge>
                    ) : null}
                    <div className="ml-auto flex flex-wrap items-center gap-1.5">
                        <label className="relative">
                            <Search
                                size={13}
                                className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-ink-3"
                                aria-hidden="true"
                            />
                            <input
                                value={search}
                                onChange={(event) => setSearch(event.target.value)}
                                placeholder="Search text columns"
                                aria-label="Search rows"
                                className="field field-sm w-48 pl-7"
                            />
                        </label>
                        <Button
                            size="sm"
                            onClick={() =>
                                setDraftFilter({
                                    column: columns[0]?.name ?? '',
                                    op: 'eq',
                                    value: '',
                                })
                            }
                            disabled={!columns.length}
                        >
                            <Filter size={13} /> Filter
                        </Button>
                        <IconButton label="Refresh" onClick={() => void refetch()}>
                            <RefreshCw size={14} className={cn(isFetching && 'animate-spin')} />
                        </IconButton>
                        <Menu
                            label="Export"
                            trigger={({ toggle, ref, id, open }) => (
                                <IconButton
                                    ref={ref}
                                    id={id}
                                    label="Export"
                                    onClick={toggle}
                                    aria-haspopup="menu"
                                    aria-expanded={open}
                                >
                                    <Download size={14} />
                                </IconButton>
                            )}
                            items={[
                                {
                                    label: 'Whole table as CSV',
                                    onSelect: () => window.location.assign(exportUrl('csv')),
                                },
                                ...(data?.table.kind === 'table'
                                    ? [
                                          {
                                              label: 'Whole table as SQL inserts',
                                              onSelect: () =>
                                                  window.location.assign(exportUrl('sql')),
                                          },
                                      ]
                                    : []),
                                'separator',
                                {
                                    label: selected.size
                                        ? `${selected.size} selected rows as CSV`
                                        : 'This page as CSV',
                                    onSelect: () => {
                                        if (!data) return
                                        const rows = selected.size
                                            ? [...selected]
                                                  .sort((a, b) => a - b)
                                                  .map((index) => data.rows[index]!)
                                            : data.rows
                                        downloadText(`${tableName}.csv`, toCsv(data.columns, rows))
                                    },
                                },
                            ]}
                        />
                        {data?.editable ? (
                            <>
                                {selected.size ? (
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        className="text-danger"
                                        onClick={() => setDeleting(true)}
                                    >
                                        <Trash2 size={13} /> Delete {selected.size}
                                    </Button>
                                ) : null}
                                <Button
                                    size="sm"
                                    variant="primary"
                                    onClick={() => {
                                        setFormError(null)
                                        setForm({ row: null })
                                    }}
                                >
                                    <Plus size={13} /> Row
                                </Button>
                            </>
                        ) : null}
                    </div>
                </div>

                {filters.length || draftFilter ? (
                    <div className="flex flex-wrap items-center gap-1.5 border-b border-rule bg-panel px-3 py-1.5">
                        {filters.map((filter, index) => (
                            <span
                                key={index}
                                className="inline-flex items-center gap-1 rounded-full border border-rule-strong bg-paper py-0.5 pr-1 pl-2.5 font-mono text-[11px]"
                            >
                                {filter.column}{' '}
                                {OPERATORS.find((operator) => operator.value === filter.op)?.label}{' '}
                                {filter.value !== undefined &&
                                !['is_null', 'not_null'].includes(filter.op) ? (
                                    <span className="text-accent-text">{filter.value}</span>
                                ) : null}
                                <button
                                    type="button"
                                    aria-label="Remove filter"
                                    onClick={() => {
                                        setFilters(
                                            filters.filter((_, position) => position !== index),
                                        )
                                        setPage(1)
                                    }}
                                    className="rounded-full p-0.5 text-ink-3 hover:text-ink"
                                >
                                    <X size={11} />
                                </button>
                            </span>
                        ))}
                        {draftFilter ? (
                            <form
                                className="flex flex-wrap items-center gap-1"
                                onSubmit={(event) => {
                                    event.preventDefault()
                                    setFilters([...filters, draftFilter])
                                    setDraftFilter(null)
                                    setPage(1)
                                }}
                            >
                                <select
                                    className="field field-sm mono w-auto"
                                    aria-label="Filter column"
                                    value={draftFilter.column}
                                    onChange={(event) =>
                                        setDraftFilter({
                                            ...draftFilter,
                                            column: event.target.value,
                                        })
                                    }
                                >
                                    {columns.map((column) => (
                                        <option key={column.name} value={column.name}>
                                            {column.name}
                                        </option>
                                    ))}
                                </select>
                                <select
                                    className="field field-sm w-auto"
                                    aria-label="Operator"
                                    value={draftFilter.op}
                                    onChange={(event) =>
                                        setDraftFilter({
                                            ...draftFilter,
                                            op: event.target.value as Operator,
                                        })
                                    }
                                >
                                    {OPERATORS.map((operator) => (
                                        <option key={operator.value} value={operator.value}>
                                            {operator.label}
                                        </option>
                                    ))}
                                </select>
                                {draftFilter.op !== 'is_null' && draftFilter.op !== 'not_null' ? (
                                    <input
                                        autoFocus
                                        className="field field-sm mono w-40"
                                        aria-label="Filter value"
                                        value={draftFilter.value ?? ''}
                                        onChange={(event) =>
                                            setDraftFilter({
                                                ...draftFilter,
                                                value: event.target.value,
                                            })
                                        }
                                    />
                                ) : null}
                                <Button size="xs" type="submit" variant="secondary">
                                    Apply
                                </Button>
                                <Button
                                    size="xs"
                                    variant="ghost"
                                    onClick={() => setDraftFilter(null)}
                                >
                                    Cancel
                                </Button>
                            </form>
                        ) : null}
                    </div>
                ) : null}

                {error ? (
                    <div className="p-4">
                        <Alert>{(error as Error).message}</Alert>
                    </div>
                ) : null}
                <div className="min-h-0 flex-1">
                    {data ? (
                        <DataGrid
                            columns={columns}
                            rows={data.rows}
                            rowNumberOffset={(data.page - 1) * data.pageSize}
                            selectable={data.editable}
                            selected={selected}
                            onSelectedChange={setSelected}
                            onRowOpen={(index) => {
                                setInspected(index)
                                setPanel('row')
                            }}
                            sort={sort}
                            onSort={(column) => {
                                setSort((current) =>
                                    current?.column === column
                                        ? current.direction === 'asc'
                                            ? { column, direction: 'desc' }
                                            : null
                                        : { column, direction: 'asc' },
                                )
                                setPage(1)
                            }}
                            emptyMessage={
                                filters.length || debouncedSearch
                                    ? 'No rows match the filters.'
                                    : 'This table is empty.'
                            }
                        />
                    ) : (
                        <LoadingRows rows={8} />
                    )}
                </div>
                <div className="flex h-10 shrink-0 items-center gap-3 border-t border-rule px-3 text-[12px] text-ink-3">
                    <span className="hidden sm:inline">Double-click a row to inspect it</span>
                    {data?.readOnlyReason ? (
                        <span className="truncate">· {data.readOnlyReason}</span>
                    ) : null}
                    <div className="ml-auto flex items-center gap-2">
                        <select
                            className="field field-sm w-auto"
                            aria-label="Rows per page"
                            value={pageSize}
                            onChange={(event) => {
                                setPageSize(Number(event.target.value))
                                setPage(1)
                            }}
                        >
                            {[25, 50, 100, 200].map((size) => (
                                <option key={size} value={size}>
                                    {size} / page
                                </option>
                            ))}
                        </select>
                        <IconButton
                            label="Previous page"
                            size="sm"
                            disabled={page <= 1}
                            onClick={() => setPage(page - 1)}
                        >
                            <ChevronLeft size={14} />
                        </IconButton>
                        <span className="font-mono tabular-nums text-ink-2">
                            {page}
                            {pages ? ` / ${formatNumber(pages)}` : ''}
                        </span>
                        <IconButton
                            label="Next page"
                            size="sm"
                            disabled={
                                !data ||
                                data.rows.length < pageSize ||
                                (pages !== null && page >= pages)
                            }
                            onClick={() => setPage(page + 1)}
                        >
                            <ChevronRight size={14} />
                        </IconButton>
                    </div>
                </div>
            </div>

            {inspectedRow || panel === 'columns' ? (
                <aside
                    aria-label="Details"
                    className="scrollbar-thin flex w-[min(24rem,40%)] shrink-0 flex-col overflow-y-auto border-l border-rule bg-panel"
                >
                    <div className="flex h-10 shrink-0 items-center border-b border-rule px-2">
                        {(['row', 'columns'] as const).map((value) => (
                            <button
                                key={value}
                                type="button"
                                onClick={() => setPanel(value)}
                                className={cn(
                                    'relative h-full px-2.5 text-[12.5px] capitalize',
                                    panel === value
                                        ? 'text-ink after:absolute after:inset-x-2 after:bottom-0 after:h-[2px] after:bg-accent'
                                        : 'text-ink-3 hover:text-ink',
                                )}
                            >
                                {value}
                            </button>
                        ))}
                        <IconButton
                            label="Close details"
                            size="sm"
                            className="ml-auto"
                            onClick={() => {
                                setInspected(null)
                                setPanel('row')
                            }}
                        >
                            <X size={14} />
                        </IconButton>
                    </div>
                    {panel === 'row' && inspectedRow ? (
                        <RowDetails
                            columns={columns}
                            row={inspectedRow}
                            editable={data?.editable ?? false}
                            onEdit={() => {
                                setFormError(null)
                                setForm({ row: inspectedRow })
                            }}
                        />
                    ) : panel === 'row' ? (
                        <p className="p-4 text-[12.5px] text-ink-3">
                            Double-click a row to see every value in it.
                        </p>
                    ) : (
                        <ColumnDetails columns={columns} />
                    )}
                </aside>
            ) : (
                <button
                    type="button"
                    onClick={() => setPanel('columns')}
                    className="hidden w-8 shrink-0 border-l border-rule bg-panel text-ink-3 hover:text-ink lg:block"
                    title="Column details"
                >
                    <span className="block rotate-90 font-mono text-[10.5px] tracking-[0.1em] whitespace-nowrap uppercase">
                        Columns
                    </span>
                </button>
            )}

            {data ? (
                <RowForm
                    open={form !== null}
                    onClose={() => setForm(null)}
                    columns={columns}
                    row={form?.row ?? null}
                    onSubmit={saveRow}
                    error={formError}
                />
            ) : null}
            <ConfirmDialog
                open={deleting}
                onClose={() => setDeleting(false)}
                onConfirm={deleteSelected}
                busy={deleteBusy}
                title={`Delete ${selected.size} row${selected.size === 1 ? '' : 's'}?`}
                confirmLabel="Delete rows"
                confirmText={selected.size > 10 ? 'delete' : undefined}
            >
                <p>
                    The selected rows are deleted from{' '}
                    <span className="font-mono text-ink">{tableName}</span> in one transaction,
                    matched by primary key. Foreign keys decide what happens to rows that reference
                    them (they may be deleted too, or the delete may be refused).
                </p>
            </ConfirmDialog>
        </div>
    )
}

function RowDetails({
    columns,
    row,
    editable,
    onEdit,
}: {
    columns: ExplorerColumn[]
    row: unknown[]
    editable: boolean
    onEdit: () => void
}) {
    const toast = useToast()
    return (
        <div>
            <div className="flex items-center justify-between border-b border-rule px-3 py-2">
                <Button
                    size="xs"
                    variant="ghost"
                    onClick={async () => {
                        await navigator.clipboard.writeText(
                            JSON.stringify(
                                Object.fromEntries(
                                    columns.map((column, index) => [column.name, row[index]]),
                                ),
                                null,
                                2,
                            ),
                        )
                        toast('Row copied as JSON', 'success')
                    }}
                >
                    <Copy size={12} /> Copy as JSON
                </Button>
                {editable ? (
                    <Button size="xs" variant="secondary" onClick={onEdit}>
                        <PenLine size={12} /> Edit
                    </Button>
                ) : null}
            </div>
            <dl className="rows">
                {columns.map((column, index) => {
                    const value = row[index]
                    const isObject = value !== null && typeof value === 'object'
                    return (
                        <div key={column.name} className="group px-3 py-2">
                            <dt className="flex items-center gap-1.5">
                                {column.isPrimaryKey ? (
                                    <KeyRound size={10} className="text-accent" />
                                ) : null}
                                <span className="font-mono text-[11.5px] text-ink-2">
                                    {column.name}
                                </span>
                                <span className="font-mono text-[10px] text-ink-3">
                                    {column.type}
                                </span>
                                <button
                                    type="button"
                                    aria-label={`Copy ${column.name}`}
                                    onClick={async () => {
                                        await navigator.clipboard.writeText(copyText(value))
                                        toast('Copied', 'success')
                                    }}
                                    className="ml-auto rounded p-0.5 text-ink-3 opacity-0 group-hover:opacity-100 hover:text-ink focus:opacity-100"
                                >
                                    <Copy size={11} />
                                </button>
                            </dt>
                            <dd className="mt-0.5 text-[12.5px] break-words">
                                {value === null ? (
                                    <span className="font-mono text-[11px] text-ink-3 italic">
                                        NULL
                                    </span>
                                ) : isObject ? (
                                    <pre className="scrollbar-thin max-h-48 overflow-auto rounded border border-rule bg-paper p-2 font-mono text-[11px]">
                                        {JSON.stringify(value, null, 2)}
                                    </pre>
                                ) : (
                                    <span className={cn(typeof value === 'boolean' && 'font-mono')}>
                                        {displayValue(value)}
                                    </span>
                                )}
                            </dd>
                        </div>
                    )
                })}
            </dl>
        </div>
    )
}

function ColumnDetails({ columns }: { columns: ExplorerColumn[] }) {
    return (
        <ul className="rows">
            {columns.map((column) => (
                <li key={column.name} className="px-3 py-2.5">
                    <p className="flex items-center gap-1.5 font-mono text-[12px]">
                        {column.isPrimaryKey ? (
                            <KeyRound size={11} className="text-accent" />
                        ) : null}
                        {column.name}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1">
                        <Badge>{column.type}</Badge>
                        <Badge tone={column.nullable ? 'neutral' : 'accent'}>
                            {column.nullable ? 'nullable' : 'not null'}
                        </Badge>
                        {column.identity ? (
                            <Badge tone="ok">identity {column.identity}</Badge>
                        ) : null}
                        {column.generated ? <Badge tone="warn">generated</Badge> : null}
                    </div>
                    {column.default ? (
                        <p className="mt-1 font-mono text-[11px] text-ink-3">
                            default {column.default}
                        </p>
                    ) : null}
                    {column.comment ? (
                        <p className="mt-1 text-[12px] text-ink-2">{column.comment}</p>
                    ) : null}
                </li>
            ))}
        </ul>
    )
}
