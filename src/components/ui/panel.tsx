import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function Panel({ className, children }: { className?: string; children: ReactNode }) {
    return (
        <section className={cn('rounded-lg border border-rule bg-panel', className)}>
            {children}
        </section>
    )
}

export function PanelHeader({
    title,
    eyebrow,
    description,
    actions,
    className,
}: {
    title: ReactNode
    eyebrow?: string
    description?: ReactNode
    actions?: ReactNode
    className?: string
}) {
    return (
        <header
            className={cn(
                'flex flex-wrap items-start justify-between gap-3 border-b border-rule px-4 py-3',
                className,
            )}
        >
            <div className="min-w-0">
                {eyebrow ? <p className="eyebrow mb-0.5">{eyebrow}</p> : null}
                <h2 className="text-[14px] font-semibold">{title}</h2>
                {description ? (
                    <p className="mt-0.5 text-[13px] text-ink-3">{description}</p>
                ) : null}
            </div>
            {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </header>
    )
}

/** Page heading used on non-workspace pages and workspace sections. */
export function PageHeader({
    eyebrow,
    title,
    description,
    actions,
}: {
    eyebrow?: string
    title: ReactNode
    description?: ReactNode
    actions?: ReactNode
}) {
    return (
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
                {eyebrow ? <p className="eyebrow mb-1.5">{eyebrow}</p> : null}
                <h1 className="text-[22px] font-semibold tracking-[-0.015em]">{title}</h1>
                {description ? (
                    <p className="mt-1 max-w-2xl text-[13.5px] text-ink-2">{description}</p>
                ) : null}
            </div>
            {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
    )
}

/** Label-value readout, as on the overview and connection panels. */
export function Readout({
    label,
    value,
    hint,
}: {
    label: string
    value: ReactNode
    hint?: ReactNode
}) {
    return (
        <div className="min-w-0">
            <p className="eyebrow">{label}</p>
            <p className="mt-1 truncate text-[20px] font-semibold tracking-[-0.01em] tabular-nums">
                {value}
            </p>
            {hint ? <p className="mt-0.5 truncate text-[12px] text-ink-3">{hint}</p> : null}
        </div>
    )
}
