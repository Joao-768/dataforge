'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'

// Daily bars drawn in ink, like the strip charts in Pulse Monitor. An
// optional second value (failures) sits at the base of each bar in the
// reserved danger colour, separated by a 2px surface gap. Hovering a bar
// shows its exact values; the same numbers are available as a table.

export interface BarDatum {
    label: string
    value: number
    highlight?: number
    tooltip: string
}

export function BarChart({
    data,
    height = 140,
    format = (value: number) => String(value),
    valueLabel,
    highlightLabel,
    emptyText = 'No data in this period',
}: {
    data: BarDatum[]
    height?: number
    format?: (value: number) => string
    valueLabel: string
    highlightLabel?: string
    emptyText?: string
}) {
    const [hover, setHover] = useState<number | null>(null)
    const max = Math.max(0, ...data.map((datum) => datum.value))
    const ticks = max === 0 ? [0] : [0, max / 2, max]

    return (
        <figure className="min-w-0">
            <div className="relative" style={{ height }}>
                {ticks.map((tick) => (
                    <div
                        key={tick}
                        className="pointer-events-none absolute inset-x-0 flex items-center gap-2"
                        style={{ bottom: max === 0 ? 0 : (tick / max) * (height - 4) }}
                    >
                        <span className="w-10 shrink-0 text-right font-mono text-[10px] text-ink-3 tabular-nums">
                            {format(tick)}
                        </span>
                        <span className="h-px flex-1 bg-grid" />
                    </div>
                ))}
                <div
                    className="absolute inset-y-0 right-0 left-12 flex items-end gap-[2px]"
                    onMouseLeave={() => setHover(null)}
                >
                    {data.map((datum, index) => {
                        const total = max === 0 ? 0 : (datum.value / max) * (height - 4)
                        const failed =
                            max === 0 || !datum.highlight
                                ? 0
                                : (datum.highlight / max) * (height - 4)
                        return (
                            <div
                                key={datum.label}
                                className="relative flex h-full min-w-0 flex-1 flex-col justify-end"
                                onMouseEnter={() => setHover(index)}
                                onFocus={() => setHover(index)}
                                tabIndex={0}
                                aria-label={datum.tooltip}
                            >
                                {datum.value > 0 ? (
                                    <div
                                        className="flex flex-col justify-end"
                                        style={{ height: Math.max(total, 3) }}
                                    >
                                        <div
                                            className={cn(
                                                'w-full rounded-t-[4px] transition-opacity',
                                                hover !== null && hover !== index
                                                    ? 'bg-ink/35'
                                                    : 'bg-ink/80',
                                            )}
                                            style={{
                                                height: Math.max(
                                                    total - failed - (failed > 0 ? 2 : 0),
                                                    failed > 0 ? 0 : 3,
                                                ),
                                            }}
                                        />
                                        {failed > 0 ? (
                                            <div
                                                className={cn(
                                                    'mt-[2px] w-full bg-danger',
                                                    total - failed < 3 && 'rounded-t-[4px]',
                                                )}
                                                style={{ height: Math.max(failed, 2) }}
                                            />
                                        ) : null}
                                    </div>
                                ) : (
                                    <div className="h-px w-full bg-rule-strong" />
                                )}
                                {hover === index ? (
                                    <div
                                        role="tooltip"
                                        className="pointer-events-none absolute bottom-full z-10 mb-2 w-max max-w-[14rem] -translate-x-1/2 rounded-md bg-ink px-2.5 py-1.5 text-[11.5px] text-on-ink shadow-lg"
                                        style={{ left: '50%' }}
                                    >
                                        <p className="font-medium">{datum.label}</p>
                                        <p className="font-mono">
                                            {valueLabel}: {format(datum.value)}
                                        </p>
                                        {highlightLabel ? (
                                            <p className="font-mono">
                                                {highlightLabel}: {format(datum.highlight ?? 0)}
                                            </p>
                                        ) : null}
                                    </div>
                                ) : null}
                            </div>
                        )
                    })}
                </div>
            </div>
            <div className="mt-1.5 ml-12 flex justify-between font-mono text-[10px] text-ink-3">
                <span>{data[0]?.label}</span>
                <span>{data.at(-1)?.label}</span>
            </div>
            {highlightLabel ? (
                <figcaption className="mt-2 ml-12 flex items-center gap-4 text-[11.5px] text-ink-2">
                    <span className="flex items-center gap-1.5">
                        <span className="h-2.5 w-2.5 rounded-sm bg-ink/80" /> {valueLabel}
                    </span>
                    <span className="flex items-center gap-1.5">
                        <span className="h-2.5 w-2.5 rounded-sm bg-danger" /> {highlightLabel}
                    </span>
                </figcaption>
            ) : null}
            {max === 0 ? <p className="mt-2 ml-12 text-[12px] text-ink-3">{emptyText}</p> : null}
            <details className="mt-2 ml-12 text-[12px]">
                <summary className="cursor-pointer text-ink-3 hover:text-ink">
                    Show as table
                </summary>
                <table className="mt-2 w-full max-w-md font-mono text-[11.5px]">
                    <thead>
                        <tr className="text-left text-ink-3">
                            <th className="py-1 font-normal">Day</th>
                            <th className="py-1 text-right font-normal">{valueLabel}</th>
                            {highlightLabel ? (
                                <th className="py-1 text-right font-normal">{highlightLabel}</th>
                            ) : null}
                        </tr>
                    </thead>
                    <tbody>
                        {data.map((datum) => (
                            <tr key={datum.label} className="border-t border-rule">
                                <td className="py-1">{datum.label}</td>
                                <td className="py-1 text-right">{format(datum.value)}</td>
                                {highlightLabel ? (
                                    <td className="py-1 text-right">
                                        {format(datum.highlight ?? 0)}
                                    </td>
                                ) : null}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </details>
        </figure>
    )
}
