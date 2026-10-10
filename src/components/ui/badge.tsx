import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type BadgeTone = 'neutral' | 'accent' | 'ok' | 'warn' | 'danger'

const TONES: Record<BadgeTone, string> = {
    neutral: 'bg-raised text-ink-2',
    accent: 'bg-accent-soft text-accent-text',
    ok: 'bg-ok-soft text-ok',
    warn: 'bg-warn-soft text-warn',
    danger: 'bg-danger-soft text-danger-text',
}

const DOTS: Record<BadgeTone, string> = {
    neutral: 'bg-ink-3',
    accent: 'bg-accent',
    ok: 'bg-ok',
    warn: 'bg-warn',
    danger: 'bg-danger',
}

/** Mono uppercase status pill, the same shape as Pulse Monitor's. */
export function Badge({
    tone = 'neutral',
    dot = false,
    pulse = false,
    children,
    className,
}: {
    tone?: BadgeTone
    dot?: boolean
    pulse?: boolean
    children: ReactNode
    className?: string
}) {
    return (
        <span
            className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[10.5px] font-medium tracking-[0.06em] whitespace-nowrap uppercase',
                TONES[tone],
                className,
            )}
        >
            {dot ? <StatusDot tone={tone} pulse={pulse} /> : null}
            {children}
        </span>
    )
}

export function StatusDot({
    tone,
    pulse = false,
    className,
}: {
    tone: BadgeTone
    pulse?: boolean
    className?: string
}) {
    return (
        <span
            className={cn('relative inline-flex h-1.5 w-1.5 shrink-0', className)}
            aria-hidden="true"
        >
            {pulse ? (
                <span
                    className={cn(
                        'absolute inset-0 animate-ping rounded-full opacity-60',
                        DOTS[tone],
                    )}
                />
            ) : null}
            <span className={cn('relative inline-flex h-1.5 w-1.5 rounded-full', DOTS[tone])} />
        </span>
    )
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
    return (
        <kbd
            className={cn(
                'inline-flex h-5 min-w-5 items-center justify-center rounded border border-rule-strong bg-panel px-1 font-mono text-[10.5px] text-ink-2',
                className,
            )}
        >
            {children}
        </kbd>
    )
}
