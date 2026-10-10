'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, GitBranch, Table2, Terminal, Workflow } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { ButtonLink } from '@/components/ui/button'
import { Alert, Skeleton } from '@/components/ui/feedback'
import { Panel, PanelHeader, Readout } from '@/components/ui/panel'
import { api, projectApi } from '@/lib/api'
import { formatDuration, formatNumber, formatRelative } from '@/lib/format'
import type { Migration } from '@/server/migrations/service'
import { useProject, useProjectId } from '@/features/workspace/context'
import { useLiveSchema } from '@/features/workspace/queries'
import { ConnectionPanel } from '@/features/overview/connection-panel'

interface QueryTotals {
    totals: { total: number; failed: number; p95Ms: number | null }
}

export function Overview() {
    const projectId = useProjectId()
    const { data: details } = useProject()
    const hasDatabase = Boolean(details?.connection)
    const schema = useLiveSchema(projectId, hasDatabase)
    const stats = useQuery({
        queryKey: ['analytics', projectId, 'queries', 14],
        queryFn: () => api<QueryTotals>(projectApi(projectId, '/analytics/queries?days=14')),
    })
    const migrations = useQuery({
        queryKey: ['migrations', projectId],
        queryFn: () => api<{ migrations: Migration[] }>(projectApi(projectId, '/migrations')),
    })

    const base = `/projects/${projectId}`
    const tables = schema.data?.tables ?? []
    const rows = tables.reduce((sum, table) => sum + (table.rowEstimate ?? 0), 0)
    const relationships = tables.reduce((sum, table) => sum + table.foreignKeys.length, 0)
    const applied =
        migrations.data?.migrations.filter((migration) => migration.status === 'applied') ?? []

    return (
        <main className="mx-auto w-full max-w-[1200px] px-4 pt-6 pb-16 sm:px-6">
            <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
                <div className="min-w-0">
                    <p className="eyebrow mb-1.5">Overview</p>
                    <h1 className="truncate text-[22px] font-semibold tracking-[-0.015em]">
                        {details?.project.name ?? <Skeleton className="h-7 w-48" />}
                    </h1>
                    {details?.project.description ? (
                        <p className="mt-1 max-w-2xl text-[13.5px] text-ink-2">
                            {details.project.description}
                        </p>
                    ) : null}
                </div>
                {hasDatabase ? (
                    <div className="flex flex-wrap gap-2">
                        <ButtonLink href={`${base}/designer`} variant="secondary">
                            <Workflow size={15} aria-hidden="true" /> Open designer
                        </ButtonLink>
                        <ButtonLink href={`${base}/sql`} variant="primary">
                            <Terminal size={15} aria-hidden="true" /> New query
                        </ButtonLink>
                    </div>
                ) : null}
            </div>

            {hasDatabase ? (
                <Panel className="mb-6 grid grid-cols-2 gap-x-6 gap-y-5 px-5 py-4 md:grid-cols-5">
                    <Readout
                        label="Tables"
                        value={schema.data ? formatNumber(tables.length) : '…'}
                        hint={`${formatNumber(schema.data?.views.length ?? 0)} views`}
                    />
                    <Readout
                        label="Rows (est.)"
                        value={schema.data ? formatNumber(rows) : '…'}
                        hint="planner statistics"
                    />
                    <Readout
                        label="Relationships"
                        value={schema.data ? formatNumber(relationships) : '…'}
                        hint="foreign keys"
                    />
                    <Readout
                        label="Queries · 14d"
                        value={stats.data ? formatNumber(stats.data.totals.total) : '…'}
                        hint={
                            stats.data
                                ? `${formatNumber(stats.data.totals.failed)} failed · p95 ${formatDuration(stats.data.totals.p95Ms)}`
                                : ' '
                        }
                    />
                    <Readout
                        label="Migrations"
                        value={migrations.data ? formatNumber(applied.length) : '…'}
                        hint={
                            applied[0]
                                ? `last ${formatRelative(applied[0].appliedAt)}`
                                : 'none applied'
                        }
                    />
                </Panel>
            ) : null}

            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
                <div className="space-y-6">
                    {hasDatabase ? (
                        <Panel>
                            <PanelHeader
                                title="Tables"
                                eyebrow="Live schema"
                                actions={
                                    <Link
                                        href={`${base}/data`}
                                        className="flex items-center gap-1 text-[12.5px] text-ink-2 hover:text-ink"
                                    >
                                        Browse data <ArrowRight size={13} />
                                    </Link>
                                }
                            />
                            {schema.isLoading ? (
                                <div className="space-y-2 p-4">
                                    {[0, 1, 2, 3].map((index) => (
                                        <Skeleton key={index} className="h-8" />
                                    ))}
                                </div>
                            ) : schema.error ? (
                                <div className="p-4">
                                    <Alert>{(schema.error as Error).message}</Alert>
                                </div>
                            ) : tables.length === 0 ? (
                                <div className="px-4 py-8 text-center text-[13px] text-ink-3">
                                    No tables yet.{' '}
                                    <Link
                                        href={`${base}/designer`}
                                        className="text-ink underline-offset-2 hover:underline"
                                    >
                                        Design the first one
                                    </Link>
                                </div>
                            ) : (
                                <table className="w-full text-[13px]">
                                    <thead>
                                        <tr className="border-b border-rule text-left">
                                            <th className="eyebrow px-4 py-2 font-medium">Table</th>
                                            <th className="eyebrow px-4 py-2 text-right font-medium">
                                                Columns
                                            </th>
                                            <th className="eyebrow hidden px-4 py-2 text-right font-medium sm:table-cell">
                                                Rows (est.)
                                            </th>
                                            <th className="eyebrow hidden px-4 py-2 font-medium md:table-cell">
                                                Keys
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody className="rows">
                                        {tables.map((table) => (
                                            <tr key={table.id} className="hover:bg-raised/60">
                                                <td className="px-4 py-2">
                                                    <Link
                                                        href={`${base}/data?schema=${encodeURIComponent(table.schema)}&table=${encodeURIComponent(table.name)}`}
                                                        className="flex items-center gap-2 font-mono text-[12.5px] hover:text-accent"
                                                    >
                                                        <Table2
                                                            size={13}
                                                            className="text-ink-3"
                                                            aria-hidden="true"
                                                        />
                                                        {table.schema === 'public'
                                                            ? ''
                                                            : `${table.schema}.`}
                                                        {table.name}
                                                    </Link>
                                                </td>
                                                <td className="px-4 py-2 text-right tabular-nums text-ink-2">
                                                    {table.columns.length}
                                                </td>
                                                <td className="hidden px-4 py-2 text-right tabular-nums text-ink-2 sm:table-cell">
                                                    {table.rowEstimate === null
                                                        ? 'unknown'
                                                        : formatNumber(table.rowEstimate)}
                                                </td>
                                                <td className="hidden px-4 py-2 md:table-cell">
                                                    <span className="flex gap-1">
                                                        {table.primaryKey ? (
                                                            <Badge tone="accent">PK</Badge>
                                                        ) : (
                                                            <Badge tone="warn">No PK</Badge>
                                                        )}
                                                        {table.foreignKeys.length ? (
                                                            <Badge>
                                                                {table.foreignKeys.length} FK
                                                            </Badge>
                                                        ) : null}
                                                    </span>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </Panel>
                    ) : null}

                    <ConnectionPanel />
                </div>

                <div className="space-y-6">
                    {hasDatabase ? (
                        <Panel>
                            <PanelHeader title="Next steps" />
                            <ul className="rows">
                                {[
                                    {
                                        href: `${base}/designer`,
                                        icon: Workflow,
                                        title: 'Design the schema',
                                        text: 'Tables, keys and relationships on a canvas',
                                    },
                                    {
                                        href: `${base}/sql`,
                                        icon: Terminal,
                                        title: 'Query the database',
                                        text: 'Read-only by default, with EXPLAIN',
                                    },
                                    {
                                        href: `${base}/migrations`,
                                        icon: GitBranch,
                                        title: 'Review migrations',
                                        text: 'Generated SQL, applied in one transaction',
                                    },
                                ].map((item) => (
                                    <li key={item.href}>
                                        <Link
                                            href={item.href}
                                            className="group flex items-center gap-3 px-4 py-3 hover:bg-raised/60"
                                        >
                                            <item.icon
                                                size={15}
                                                className="text-ink-3 group-hover:text-accent"
                                                aria-hidden="true"
                                            />
                                            <span className="min-w-0 flex-1">
                                                <span className="block text-[13.5px] font-medium">
                                                    {item.title}
                                                </span>
                                                <span className="block text-[12px] text-ink-3">
                                                    {item.text}
                                                </span>
                                            </span>
                                            <ArrowRight
                                                size={13}
                                                className="text-ink-3"
                                                aria-hidden="true"
                                            />
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        </Panel>
                    ) : null}
                    <Panel>
                        <PanelHeader title="Activity" eyebrow="This project" />
                        {!details ? (
                            <div className="space-y-2 p-4">
                                <Skeleton className="h-8" />
                                <Skeleton className="h-8" />
                            </div>
                        ) : details.activity.length === 0 ? (
                            <p className="px-4 py-6 text-[13px] text-ink-3">No activity yet.</p>
                        ) : (
                            <ol className="rows">
                                {details.activity.map((entry) => (
                                    <li key={entry.id} className="px-4 py-2.5">
                                        <p className="text-[13px] leading-snug">{entry.message}</p>
                                        <p className="mt-0.5 font-mono text-[11px] text-ink-3">
                                            {formatRelative(entry.createdAt)}
                                        </p>
                                    </li>
                                ))}
                            </ol>
                        )}
                    </Panel>
                </div>
            </div>
        </main>
    )
}
