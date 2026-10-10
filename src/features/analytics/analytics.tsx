'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Database, Info } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Alert, LoadingRows } from '@/components/ui/feedback'
import { Panel, PanelHeader, Readout } from '@/components/ui/panel'
import { api, projectApi } from '@/lib/api'
import { formatBytes, formatDuration, formatNumber, formatRelative } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { engineStats, queryStats } from '@/server/analytics/service'
import { useProjectId } from '@/features/workspace/context'
import { BarChart } from '@/features/analytics/bar-chart'

type QueryStats = Awaited<ReturnType<typeof queryStats>>
type EngineStats = Awaited<ReturnType<typeof engineStats>>

function shortDay(day: string) {
    return new Date(`${day}T00:00:00`).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
    })
}

export function Analytics() {
    const projectId = useProjectId()
    const [days, setDays] = useState(14)
    const stats = useQuery({
        queryKey: ['analytics', projectId, 'queries', days],
        queryFn: () => api<QueryStats>(projectApi(projectId, `/analytics/queries?days=${days}`)),
    })
    const engine = useQuery({
        queryKey: ['analytics', projectId, 'engine'],
        queryFn: () => api<EngineStats>(projectApi(projectId, '/analytics/engine')),
    })
    const totals = stats.data?.totals

    return (
        <main className="mx-auto w-full max-w-[1300px] px-4 pt-6 pb-16 sm:px-6">
            <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
                <div>
                    <p className="eyebrow mb-1.5">Query analytics</p>
                    <h1 className="text-[22px] font-semibold tracking-[-0.015em]">Analytics</h1>
                    <p className="mt-1 max-w-2xl text-[13.5px] text-ink-2">
                        Timings come from DataForge&apos;s own query history; table and index
                        figures come from PostgreSQL&apos;s statistics views. Nothing here is
                        sampled or simulated.
                    </p>
                </div>
                <div
                    role="radiogroup"
                    aria-label="Period"
                    className="flex rounded-md border border-rule-strong p-0.5"
                >
                    {[7, 14, 30].map((value) => (
                        <button
                            key={value}
                            type="button"
                            role="radio"
                            aria-checked={days === value}
                            onClick={() => setDays(value)}
                            className={cn(
                                'rounded px-2.5 py-1 font-mono text-[11.5px]',
                                days === value ? 'bg-raised text-ink' : 'text-ink-3 hover:text-ink',
                            )}
                        >
                            {value}d
                        </button>
                    ))}
                </div>
            </div>

            {stats.error ? <Alert className="mb-6">{(stats.error as Error).message}</Alert> : null}

            <Panel className="mb-6 grid grid-cols-2 gap-x-6 gap-y-5 px-5 py-4 md:grid-cols-5">
                <Readout
                    label={`Queries · ${days}d`}
                    value={totals ? formatNumber(totals.total) : '…'}
                    hint={totals ? `${formatNumber(totals.rows)} rows returned or changed` : ' '}
                />
                <Readout
                    label="Success rate"
                    value={
                        totals
                            ? totals.total
                                ? `${((totals.succeeded / totals.total) * 100).toFixed(1)}%`
                                : 'n/a'
                            : '…'
                    }
                    hint={
                        totals
                            ? `${totals.failed} errors · ${totals.cancelled} cancelled · ${totals.timedOut} timed out`
                            : ' '
                    }
                />
                <Readout
                    label="Median duration"
                    value={totals ? formatDuration(totals.p50Ms) : '…'}
                    hint="p50"
                />
                <Readout
                    label="p95 duration"
                    value={totals ? formatDuration(totals.p95Ms) : '…'}
                    hint={totals ? `average ${formatDuration(totals.avgMs)}` : ' '}
                />
                <Readout
                    label="Slowest"
                    value={totals ? formatDuration(totals.maxMs) : '…'}
                    hint="single run"
                />
            </Panel>

            <div className="mb-6 grid gap-6 lg:grid-cols-2">
                <Panel>
                    <PanelHeader
                        title="Queries per day"
                        description="Every statement run through DataForge: editor, explorer, imports, exports."
                    />
                    <div className="p-4">
                        {stats.data ? (
                            <BarChart
                                data={stats.data.daily.map((day) => ({
                                    label: shortDay(day.day),
                                    value: day.total,
                                    highlight: day.failed,
                                    tooltip: `${shortDay(day.day)}: ${day.total} queries, ${day.failed} failed`,
                                }))}
                                valueLabel="Queries"
                                highlightLabel="Failed"
                                format={(value) => formatNumber(Math.round(value))}
                            />
                        ) : (
                            <LoadingRows rows={3} />
                        )}
                    </div>
                </Panel>
                <Panel>
                    <PanelHeader
                        title="p95 duration per day"
                        description="95th percentile of run time, per day with activity."
                    />
                    <div className="p-4">
                        {stats.data ? (
                            <BarChart
                                data={stats.data.daily.map((day) => ({
                                    label: shortDay(day.day),
                                    value: day.p95Ms ?? 0,
                                    tooltip: `${shortDay(day.day)}: p95 ${formatDuration(day.p95Ms)}`,
                                }))}
                                valueLabel="p95"
                                format={(value) =>
                                    value >= 1000
                                        ? `${(value / 1000).toFixed(1)}s`
                                        : `${Math.round(value)}ms`
                                }
                            />
                        ) : (
                            <LoadingRows rows={3} />
                        )}
                    </div>
                </Panel>
            </div>

            <div className="mb-6 grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
                <Panel className="min-w-0">
                    <PanelHeader title="Slowest queries" eyebrow={`Last ${days} days`} />
                    {!stats.data ? (
                        <LoadingRows rows={4} />
                    ) : stats.data.slowest.length === 0 ? (
                        <p className="px-4 py-6 text-[13px] text-ink-3">
                            No queries recorded in this period.
                        </p>
                    ) : (
                        <ol className="rows">
                            {stats.data.slowest.map((query) => (
                                <li key={query.id} className="px-4 py-2.5">
                                    <p className="truncate font-mono text-[12px]" title={query.sql}>
                                        {query.sql
                                            .replace(/--[^\n]*\n/g, '')
                                            .replace(/\s+/g, ' ')
                                            .trim()}
                                    </p>
                                    <p className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[11px] text-ink-3">
                                        <span className="text-ink">
                                            {formatDuration(query.durationMs)}
                                        </span>
                                        <Badge tone={query.status === 'success' ? 'ok' : 'danger'}>
                                            {query.status}
                                        </Badge>
                                        <span>{query.mode.replace('_', ' ')}</span>
                                        {query.rowCount !== null ? (
                                            <span>{formatNumber(query.rowCount)} rows</span>
                                        ) : null}
                                        <span>{query.source}</span>
                                        <span className="ml-auto">
                                            {formatRelative(query.createdAt)}
                                        </span>
                                    </p>
                                </li>
                            ))}
                        </ol>
                    )}
                </Panel>
                <div className="space-y-6">
                    <Panel>
                        <PanelHeader title="By mode" />
                        {stats.data?.byMode.length ? (
                            <table className="w-full text-[12.5px]">
                                <tbody className="rows">
                                    {stats.data.byMode.map((row) => (
                                        <tr key={row.mode}>
                                            <td className="px-4 py-2 capitalize">
                                                {row.mode.replace('_', ' ')}
                                            </td>
                                            <td className="px-4 py-2 text-right font-mono tabular-nums">
                                                {formatNumber(row.total)}
                                            </td>
                                            <td className="px-4 py-2 text-right font-mono text-ink-3 tabular-nums">
                                                avg {formatDuration(row.avgMs)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        ) : (
                            <p className="px-4 py-5 text-[13px] text-ink-3">No queries yet.</p>
                        )}
                    </Panel>
                    <Panel>
                        <PanelHeader title="Most frequent errors" />
                        {stats.data?.topErrors.length ? (
                            <ul className="rows">
                                {stats.data.topErrors.map((error) => (
                                    <li
                                        key={error.message}
                                        className="flex items-start gap-2 px-4 py-2 text-[12.5px]"
                                    >
                                        <AlertTriangle
                                            size={13}
                                            className="mt-0.5 shrink-0 text-danger"
                                        />
                                        <span className="min-w-0 flex-1">{error.message}</span>
                                        <span className="font-mono text-ink-3">×{error.total}</span>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p className="px-4 py-5 text-[13px] text-ink-3">
                                No errors in this period.
                            </p>
                        )}
                    </Panel>
                </div>
            </div>

            <EngineSection
                engine={engine.data}
                loading={engine.isLoading}
                error={engine.error as Error | null}
            />
        </main>
    )
}

function EngineSection({
    engine,
    loading,
    error,
}: {
    engine: EngineStats | undefined
    loading: boolean
    error: Error | null
}) {
    if (loading) return <LoadingRows rows={4} />
    if (error) return <Alert>{error.message}</Alert>
    if (!engine) return null
    const unused = engine.indexes.filter((index) => index.scans === 0)
    return (
        <>
            <div className="mb-3 flex items-center gap-2">
                <Database size={14} className="text-ink-3" />
                <h2 className="text-[15px] font-semibold">Database engine</h2>
                <span className="font-mono text-[11px] text-ink-3">
                    PostgreSQL {engine.serverVersion}
                </span>
            </div>
            <Panel className="mb-6 grid grid-cols-2 gap-x-6 gap-y-5 px-5 py-4 md:grid-cols-4">
                <Readout
                    label="Database size"
                    value={formatBytes(engine.database.sizeBytes)}
                    hint="pg_database_size"
                />
                <Readout
                    label="Cache hit ratio"
                    value={
                        engine.database.cacheHitRatio === null
                            ? 'n/a'
                            : `${(engine.database.cacheHitRatio * 100).toFixed(2)}%`
                    }
                    hint="shared buffers, since stats reset"
                />
                <Readout
                    label="Transactions"
                    value={formatNumber(engine.database.commits)}
                    hint={`${formatNumber(engine.database.rollbacks)} rolled back`}
                />
                <Readout
                    label="Deadlocks"
                    value={formatNumber(engine.database.deadlocks)}
                    hint={`${engine.database.backends} open connections`}
                />
            </Panel>
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
                <Panel className="min-w-0 overflow-hidden">
                    <PanelHeader title="Tables" eyebrow="pg_stat_user_tables" />
                    <div className="scrollbar-thin overflow-x-auto">
                        <table className="w-full min-w-[560px] text-[12.5px]">
                            <thead>
                                <tr className="border-b border-rule text-left">
                                    <th className="eyebrow px-4 py-2 font-medium">Table</th>
                                    <th className="eyebrow px-4 py-2 text-right font-medium">
                                        Size
                                    </th>
                                    <th className="eyebrow px-4 py-2 text-right font-medium">
                                        Live rows
                                    </th>
                                    <th className="eyebrow px-4 py-2 text-right font-medium">
                                        Seq / index scans
                                    </th>
                                    <th className="eyebrow px-4 py-2 font-medium">Analyzed</th>
                                </tr>
                            </thead>
                            <tbody className="rows">
                                {engine.tables.map((table) => {
                                    const seqHeavy =
                                        table.seqScans > 50 &&
                                        (table.indexScans ?? 0) < table.seqScans &&
                                        table.liveRows > 1000
                                    return (
                                        <tr key={`${table.schema}.${table.name}`}>
                                            <td className="px-4 py-2 font-mono">{table.name}</td>
                                            <td className="px-4 py-2 text-right font-mono tabular-nums">
                                                {formatBytes(table.totalBytes)}
                                            </td>
                                            <td className="px-4 py-2 text-right font-mono tabular-nums">
                                                {formatNumber(table.liveRows)}
                                                {table.deadRows > table.liveRows * 0.2 &&
                                                table.deadRows > 100 ? (
                                                    <span
                                                        className="ml-1 text-warn"
                                                        title={`${table.deadRows} dead rows`}
                                                    >
                                                        +{formatNumber(table.deadRows)} dead
                                                    </span>
                                                ) : null}
                                            </td>
                                            <td
                                                className={cn(
                                                    'px-4 py-2 text-right font-mono tabular-nums',
                                                    seqHeavy && 'text-warn',
                                                )}
                                            >
                                                {formatNumber(table.seqScans)} /{' '}
                                                {table.indexScans === null
                                                    ? 'n/a'
                                                    : formatNumber(table.indexScans)}
                                            </td>
                                            <td className="px-4 py-2 text-ink-3">
                                                {formatRelative(table.lastAnalyzed)}
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                </Panel>
                <div className="space-y-6">
                    <Panel>
                        <PanelHeader
                            title="Index usage"
                            eyebrow="pg_stat_user_indexes"
                            description={
                                unused.length
                                    ? `${unused.length} index${unused.length === 1 ? ' has' : 'es have'} not been used since statistics were reset.`
                                    : 'Every index has been used.'
                            }
                        />
                        <ul className="rows max-h-80 overflow-y-auto">
                            {engine.indexes.slice(0, 20).map((index) => (
                                <li
                                    key={index.name}
                                    className="flex items-center gap-2 px-4 py-2 text-[12px]"
                                >
                                    <span className="min-w-0 flex-1 truncate font-mono">
                                        {index.name}
                                    </span>
                                    <span className="font-mono text-ink-3">
                                        {formatBytes(index.bytes)}
                                    </span>
                                    <span
                                        className={cn(
                                            'w-20 text-right font-mono tabular-nums',
                                            index.scans === 0 ? 'text-warn' : 'text-ink-2',
                                        )}
                                    >
                                        {formatNumber(index.scans)} scans
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </Panel>
                    <Alert tone="info">
                        <span className="flex items-start gap-2">
                            <Info size={13} className="mt-0.5 shrink-0" />
                            {engine.pgStatStatements
                                ? 'pg_stat_statements is installed on this database.'
                                : 'pg_stat_statements is not installed here, so server-wide statement statistics are not available. DataForge reports the queries that ran through it.'}
                        </span>
                    </Alert>
                </div>
            </div>
        </>
    )
}
