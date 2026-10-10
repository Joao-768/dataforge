'use client'

import { useMemo, useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { formatDuration, formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { ExplainResult } from '@/server/query/executor'

// Visualises PostgreSQL's JSON plan. With EXPLAIN the numbers are the
// planner's estimates; with EXPLAIN ANALYZE they are measured. The view says
// which one it is showing and never mixes the two silently.

interface RawPlan {
    'Node Type': string
    'Relation Name'?: string
    'Index Name'?: string
    Alias?: string
    'Join Type'?: string
    Strategy?: string
    'Startup Cost': number
    'Total Cost': number
    'Plan Rows': number
    'Plan Width': number
    'Actual Startup Time'?: number
    'Actual Total Time'?: number
    'Actual Rows'?: number
    'Actual Loops'?: number
    'Rows Removed by Filter'?: number
    'Shared Hit Blocks'?: number
    'Shared Read Blocks'?: number
    Filter?: string
    'Index Cond'?: string
    'Hash Cond'?: string
    'Join Filter'?: string
    'Merge Cond'?: string
    'Sort Key'?: string[]
    'Group Key'?: string[]
    'Sort Method'?: string
    Plans?: RawPlan[]
}

interface PlanNode {
    id: string
    raw: RawPlan
    depth: number
    /** Exclusive time (ms) for analyzed plans, exclusive cost otherwise. */
    self: number
    children: PlanNode[]
    warnings: string[]
}

function build(raw: RawPlan, analyzed: boolean, depth = 0, path = '0'): PlanNode {
    const children = (raw.Plans ?? []).map((child, index) =>
        build(child, analyzed, depth + 1, `${path}.${index}`),
    )
    const loops = raw['Actual Loops'] ?? 1
    const total = analyzed ? (raw['Actual Total Time'] ?? 0) * loops : raw['Total Cost']
    const childTotal = children.reduce(
        (sum, child) =>
            sum +
            (analyzed
                ? (child.raw['Actual Total Time'] ?? 0) * (child.raw['Actual Loops'] ?? 1)
                : child.raw['Total Cost']),
        0,
    )
    const warnings: string[] = []
    if (analyzed && raw['Actual Rows'] !== undefined) {
        const actual = raw['Actual Rows'] * loops
        const estimated = raw['Plan Rows'] * loops
        const ratio = Math.max(actual, 1) / Math.max(estimated, 1)
        if (ratio > 10 || ratio < 0.1) {
            warnings.push(
                `Row estimate off by ${ratio > 1 ? ratio.toFixed(0) : (1 / ratio).toFixed(0)}× (planned ${formatNumber(estimated)}, got ${formatNumber(actual)}). Statistics may be stale; try ANALYZE.`,
            )
        }
    }
    if (raw['Node Type'] === 'Seq Scan' && (raw['Rows Removed by Filter'] ?? 0) > 1000) {
        warnings.push(
            `Sequential scan discarded ${formatNumber(raw['Rows Removed by Filter']!)} rows; an index on the filter columns may help.`,
        )
    }
    if (raw['Sort Method']?.includes('external'))
        warnings.push('Sort spilled to disk (external merge); work_mem was too small.')
    return { id: path, raw, depth, self: Math.max(0, total - childTotal), children, warnings }
}

function flatten(node: PlanNode, collapsed: Set<string>, into: PlanNode[] = []): PlanNode[] {
    into.push(node)
    if (!collapsed.has(node.id)) for (const child of node.children) flatten(child, collapsed, into)
    return into
}

function detail(raw: RawPlan): string | null {
    const condition =
        raw['Index Cond'] ??
        raw['Hash Cond'] ??
        raw['Merge Cond'] ??
        raw['Join Filter'] ??
        raw.Filter
    if (condition) return condition
    if (raw['Sort Key']) return `by ${raw['Sort Key'].join(', ')}`
    if (raw['Group Key']) return `by ${raw['Group Key'].join(', ')}`
    return null
}

export function PlanView({ result }: { result: ExplainResult }) {
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
    const root = useMemo(() => {
        const plan = (Array.isArray(result.plan) ? result.plan[0] : result.plan) as {
            Plan: RawPlan
        }
        return build(plan.Plan, result.analyzed)
    }, [result])
    const rows = flatten(root, collapsed)
    const all = flatten(root, new Set())
    const totalSelf = all.reduce((sum, node) => sum + node.self, 0) || 1
    const hottest = all.reduce((best, node) => (node.self > best.self ? node : best), root)
    const warnings = all.flatMap((node) => node.warnings.map((warning) => ({ node, warning })))

    return (
        <div className="flex h-full flex-col">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-rule px-3 py-2 text-[12px]">
                {result.analyzed ? (
                    <Badge tone="accent">Actual execution · EXPLAIN ANALYZE</Badge>
                ) : (
                    <Badge>Estimated plan · EXPLAIN</Badge>
                )}
                {result.planningMs !== null ? (
                    <span className="text-ink-3">
                        Planning{' '}
                        <span className="font-mono text-ink">
                            {formatDuration(result.planningMs)}
                        </span>
                    </span>
                ) : null}
                {result.executionMs !== null ? (
                    <span className="text-ink-3">
                        Execution{' '}
                        <span className="font-mono text-ink">
                            {formatDuration(result.executionMs)}
                        </span>
                    </span>
                ) : (
                    <span className="text-ink-3">
                        Total cost{' '}
                        <span className="font-mono text-ink">
                            {root.raw['Total Cost'].toFixed(2)}
                        </span>
                        <span className="ml-1 text-[11px]">(planner units, not milliseconds)</span>
                    </span>
                )}
                <span className="text-ink-3">
                    Most expensive step{' '}
                    <span className="font-mono text-ink">{hottest.raw['Node Type']}</span>
                </span>
            </div>
            {warnings.length > 0 ? (
                <ul className="space-y-1 border-b border-rule bg-warn-soft px-3 py-2">
                    {warnings.slice(0, 4).map(({ node, warning }, index) => (
                        <li key={index} className="flex items-start gap-2 text-[12px]">
                            <AlertTriangle size={13} className="mt-0.5 shrink-0 text-warn" />
                            <span>
                                <span className="font-mono">{node.raw['Node Type']}</span>:{' '}
                                {warning}
                            </span>
                        </li>
                    ))}
                </ul>
            ) : null}
            <div className="scrollbar-thin min-h-0 flex-1 overflow-auto">
                <table className="w-full min-w-[760px] text-[12px]">
                    <thead className="sticky top-0 z-10 bg-panel">
                        <tr className="border-b border-rule text-left">
                            <th className="eyebrow px-3 py-2 font-medium">Step</th>
                            <th className="eyebrow w-40 px-3 py-2 font-medium">
                                {result.analyzed ? 'Self time' : 'Self cost'}
                            </th>
                            <th className="eyebrow px-3 py-2 text-right font-medium">
                                Rows (est.)
                            </th>
                            {result.analyzed ? (
                                <th className="eyebrow px-3 py-2 text-right font-medium">
                                    Rows (actual)
                                </th>
                            ) : null}
                            {result.analyzed ? (
                                <th className="eyebrow px-3 py-2 text-right font-medium">Loops</th>
                            ) : null}
                            {result.analyzed ? (
                                <th className="eyebrow px-3 py-2 text-right font-medium">
                                    Buffers
                                </th>
                            ) : null}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((node) => {
                            const share = node.self / totalSelf
                            const raw = node.raw
                            const condition = detail(raw)
                            return (
                                <tr
                                    key={node.id}
                                    className="border-b border-rule/70 align-top hover:bg-raised/60"
                                >
                                    <td className="px-3 py-1.5">
                                        <div
                                            className="flex items-start gap-1"
                                            style={{ paddingLeft: node.depth * 16 }}
                                        >
                                            {node.children.length ? (
                                                <button
                                                    type="button"
                                                    aria-label={
                                                        collapsed.has(node.id)
                                                            ? 'Expand'
                                                            : 'Collapse'
                                                    }
                                                    onClick={() =>
                                                        setCollapsed((current) => {
                                                            const next = new Set(current)
                                                            if (next.has(node.id))
                                                                next.delete(node.id)
                                                            else next.add(node.id)
                                                            return next
                                                        })
                                                    }
                                                    className="mt-0.5 text-ink-3 hover:text-ink"
                                                >
                                                    {collapsed.has(node.id) ? (
                                                        <ChevronRight size={12} />
                                                    ) : (
                                                        <ChevronDown size={12} />
                                                    )}
                                                </button>
                                            ) : (
                                                <span className="w-3" />
                                            )}
                                            <div className="min-w-0">
                                                <p className="flex flex-wrap items-center gap-1.5">
                                                    <span
                                                        className={cn(
                                                            'font-medium',
                                                            node === hottest && 'text-accent',
                                                        )}
                                                    >
                                                        {raw['Join Type']
                                                            ? `${raw['Join Type']} `
                                                            : ''}
                                                        {raw['Node Type']}
                                                        {raw.Strategy && raw.Strategy !== 'Plain'
                                                            ? ` (${raw.Strategy})`
                                                            : ''}
                                                    </span>
                                                    {raw['Relation Name'] ? (
                                                        <span className="font-mono text-ink-2">
                                                            on {raw['Relation Name']}
                                                            {raw.Alias &&
                                                            raw.Alias !== raw['Relation Name']
                                                                ? ` ${raw.Alias}`
                                                                : ''}
                                                        </span>
                                                    ) : null}
                                                    {raw['Index Name'] ? (
                                                        <span className="font-mono text-ink-3">
                                                            using {raw['Index Name']}
                                                        </span>
                                                    ) : null}
                                                    {node.warnings.length ? (
                                                        <AlertTriangle
                                                            size={12}
                                                            className="text-warn"
                                                        />
                                                    ) : null}
                                                </p>
                                                {condition ? (
                                                    <p
                                                        className="truncate font-mono text-[11px] text-ink-3"
                                                        title={condition}
                                                    >
                                                        {condition}
                                                    </p>
                                                ) : null}
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-3 py-1.5">
                                        <div className="flex items-center gap-2">
                                            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-raised">
                                                <div
                                                    className={cn(
                                                        'h-full rounded-full',
                                                        node === hottest ? 'bg-accent' : 'bg-ink-3',
                                                    )}
                                                    style={{
                                                        width: `${Math.max(2, share * 100)}%`,
                                                    }}
                                                />
                                            </div>
                                            <span className="font-mono tabular-nums text-ink-2">
                                                {result.analyzed
                                                    ? formatDuration(node.self)
                                                    : node.self.toFixed(1)}
                                            </span>
                                        </div>
                                    </td>
                                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-ink-2">
                                        {formatNumber(raw['Plan Rows'])}
                                    </td>
                                    {result.analyzed ? (
                                        <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                                            {formatNumber(raw['Actual Rows'] ?? 0)}
                                        </td>
                                    ) : null}
                                    {result.analyzed ? (
                                        <td className="px-3 py-1.5 text-right font-mono tabular-nums text-ink-2">
                                            {raw['Actual Loops'] ?? 1}
                                        </td>
                                    ) : null}
                                    {result.analyzed ? (
                                        <td
                                            className="px-3 py-1.5 text-right font-mono text-[11px] text-ink-3"
                                            title="shared blocks: hit / read"
                                        >
                                            {raw['Shared Hit Blocks'] ?? 0} /{' '}
                                            {raw['Shared Read Blocks'] ?? 0}
                                        </td>
                                    ) : null}
                                </tr>
                            )
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    )
}
