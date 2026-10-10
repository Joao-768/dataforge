'use client'

import { useEffect, useState } from 'react'
import { CheckCircle2, Download, Loader2, OctagonX, Square, Terminal } from 'lucide-react'
import { DataGrid, downloadText, toCsv } from '@/components/data-grid'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/feedback'
import { formatDuration, formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { ExplainResult, RunResult } from '@/server/query/executor'
import { PlanView } from '@/features/sql/plan-view'

export type Outcome =
    | { kind: 'idle' }
    | { kind: 'running'; startedAt: number; mode: 'read' | 'write' | 'explain' }
    | { kind: 'run'; result: RunResult }
    | { kind: 'explain'; result: ExplainResult }
    | {
          kind: 'failure'
          message: string
          code?: string | null
          detail?: string | null
          hint?: string | null
      }

function Elapsed({ since }: { since: number }) {
    const [now, setNow] = useState(() => Date.now())
    useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 100)
        return () => window.clearInterval(timer)
    }, [])
    return <span className="font-mono tabular-nums">{((now - since) / 1000).toFixed(1)}s</span>
}

export function ResultsPanel({ outcome, onCancel }: { outcome: Outcome; onCancel: () => void }) {
    const [active, setActive] = useState(0)
    const results = outcome.kind === 'run' ? outcome.result.results : []
    useEffect(() => {
        if (outcome.kind === 'run') {
            const withRows = outcome.result.results.findLastIndex(
                (result) => result.fields.length > 0,
            )
            setActive(outcome.result.error ? outcome.result.results.length : Math.max(0, withRows))
        }
    }, [outcome])

    if (outcome.kind === 'idle') {
        return (
            <EmptyState
                icon={<Terminal size={18} />}
                title="Run a query to see results"
                className="h-full"
            >
                <span>
                    <kbd className="font-mono">⌘/Ctrl+Enter</kbd> runs the statement under the
                    cursor or the selection.
                </span>
            </EmptyState>
        )
    }
    if (outcome.kind === 'running') {
        return (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-[13px] text-ink-2">
                <span className="flex items-center gap-2">
                    <Loader2 size={15} className="animate-spin text-accent" />
                    {outcome.mode === 'explain' ? 'Planning' : 'Running'} ·{' '}
                    <Elapsed since={outcome.startedAt} />
                </span>
                <Button size="sm" variant="secondary" onClick={onCancel}>
                    <Square size={11} className="fill-current" /> Cancel{' '}
                    <kbd className="ml-1 font-mono text-[10px] text-ink-3">Esc</kbd>
                </Button>
            </div>
        )
    }
    if (outcome.kind === 'failure')
        return (
            <ErrorView
                message={outcome.message}
                code={outcome.code}
                detail={outcome.detail}
                hint={outcome.hint}
            />
        )
    if (outcome.kind === 'explain') return <PlanView result={outcome.result} />

    const run = outcome.result
    const tabs = [
        ...results.map((result, index) => ({
            label: result.fields.length ? `Result ${index + 1}` : (result.command ?? 'Statement'),
            count: result.fields.length
                ? result.truncated
                    ? `${formatNumber(result.rows.length)}+`
                    : formatNumber(result.rowCount ?? result.rows.length)
                : null,
        })),
        ...(run.error ? [{ label: 'Error', count: null }] : []),
        ...(run.notices.length ? [{ label: 'Messages', count: String(run.notices.length) }] : []),
    ]
    const current = results[active]

    return (
        <div className="flex h-full flex-col">
            <div className="flex h-9 shrink-0 items-center gap-3 border-b border-rule px-2">
                <div
                    role="tablist"
                    aria-label="Results"
                    className="scrollbar-thin flex min-w-0 flex-1 items-stretch overflow-x-auto"
                >
                    {tabs.map((tab, index) => (
                        <button
                            key={index}
                            type="button"
                            role="tab"
                            aria-selected={active === index}
                            onClick={() => setActive(index)}
                            className={cn(
                                'relative flex shrink-0 items-center gap-1.5 px-2.5 text-[12px]',
                                active === index
                                    ? 'text-ink after:absolute after:inset-x-2 after:bottom-0 after:h-[2px] after:bg-accent'
                                    : 'text-ink-3 hover:text-ink',
                                tab.label === 'Error' && 'text-danger',
                            )}
                        >
                            {tab.label}
                            {tab.count ? (
                                <span className="font-mono text-[10.5px] text-ink-3">
                                    {tab.count}
                                </span>
                            ) : null}
                        </button>
                    ))}
                </div>
                <div className="flex shrink-0 items-center gap-2.5 font-mono text-[11px] text-ink-3">
                    {run.status === 'success' ? (
                        <span className="flex items-center gap-1 text-ok">
                            <CheckCircle2 size={12} /> {run.mode === 'write' ? 'committed' : 'ok'}
                        </span>
                    ) : (
                        <span className="flex items-center gap-1 text-danger">
                            <OctagonX size={12} /> {run.status}
                            {run.mode === 'write' ? ' · rolled back' : ''}
                        </span>
                    )}
                    <span>{formatDuration(run.durationMs)}</span>
                    {current?.fields.length ? (
                        <Button
                            size="xs"
                            variant="ghost"
                            onClick={() =>
                                downloadText(
                                    `result-${active + 1}.csv`,
                                    toCsv(current.fields, current.rows),
                                )
                            }
                            title="Download this result as CSV"
                        >
                            <Download size={12} /> CSV
                        </Button>
                    ) : null}
                </div>
            </div>
            <div className="min-h-0 flex-1">
                {active < results.length && current ? (
                    current.fields.length ? (
                        <div className="flex h-full flex-col">
                            {current.truncated ? (
                                <p className="border-b border-rule bg-warn-soft px-3 py-1 text-[11.5px]">
                                    Showing the first {formatNumber(current.rows.length)} rows. Add
                                    a LIMIT or export the table for everything.
                                </p>
                            ) : null}
                            <div className="min-h-0 flex-1">
                                <DataGrid
                                    columns={current.fields}
                                    rows={current.rows}
                                    emptyMessage="The query returned no rows."
                                />
                            </div>
                        </div>
                    ) : (
                        <div className="p-4 text-[13px]">
                            <p className="font-mono">
                                {current.command ?? 'OK'}
                                {current.rowCount !== null ? (
                                    <span className="text-ink-2">
                                        {' '}
                                        · {formatNumber(current.rowCount)} row
                                        {current.rowCount === 1 ? '' : 's'} affected
                                    </span>
                                ) : null}
                            </p>
                            <p className="mt-1 font-mono text-[11px] text-ink-3">
                                {formatDuration(current.durationMs)}
                            </p>
                            {run.mode === 'read' &&
                            current.command &&
                            current.command !== 'SELECT' ? (
                                <p className="mt-3 text-[12px] text-ink-3">
                                    Read mode: everything ran inside a read-only transaction that
                                    was rolled back.
                                </p>
                            ) : null}
                        </div>
                    )
                ) : tabs[active]?.label === 'Error' && run.error ? (
                    <ErrorView
                        message={run.error.message}
                        code={run.error.code}
                        detail={run.error.detail}
                        hint={run.error.hint}
                        statement={
                            run.error.statementIndex !== null ? run.error.statementIndex + 1 : null
                        }
                        rolledBack={run.mode === 'write'}
                    />
                ) : (
                    <ul className="scrollbar-thin h-full overflow-auto p-3 font-mono text-[12px] text-ink-2">
                        {run.notices.map((notice, index) => (
                            <li key={index}>{notice}</li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    )
}

function ErrorView({
    message,
    code,
    detail,
    hint,
    statement,
    rolledBack,
}: {
    message: string
    code?: string | null
    detail?: string | null
    hint?: string | null
    statement?: number | null
    rolledBack?: boolean
}) {
    return (
        <div className="scrollbar-thin h-full overflow-auto p-4">
            <div className="rounded-md border border-danger/35 bg-danger-soft p-3.5">
                <p className="flex flex-wrap items-center gap-2 text-[13px] font-medium text-danger-text">
                    <OctagonX size={14} />
                    {message}
                </p>
                <dl className="mt-2 space-y-1 text-[12px]">
                    {statement ? (
                        <div className="flex gap-2">
                            <dt className="w-20 shrink-0 text-ink-3">Statement</dt>
                            <dd>{statement}</dd>
                        </div>
                    ) : null}
                    {code ? (
                        <div className="flex gap-2">
                            <dt className="w-20 shrink-0 text-ink-3">SQLSTATE</dt>
                            <dd className="font-mono">{code}</dd>
                        </div>
                    ) : null}
                    {detail ? (
                        <div className="flex gap-2">
                            <dt className="w-20 shrink-0 text-ink-3">Detail</dt>
                            <dd className="font-mono break-all">{detail}</dd>
                        </div>
                    ) : null}
                    {hint ? (
                        <div className="flex gap-2">
                            <dt className="w-20 shrink-0 text-ink-3">Hint</dt>
                            <dd>{hint}</dd>
                        </div>
                    ) : null}
                </dl>
                {rolledBack ? (
                    <p className="mt-2.5">
                        <Badge tone="neutral">Nothing was committed</Badge>
                    </p>
                ) : null}
            </div>
        </div>
    )
}
