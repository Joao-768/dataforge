import type { ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

export function Spinner({ className }: { className?: string }) {
    return (
        <span
            aria-hidden="true"
            className={cn(
                'inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent',
                className,
            )}
        />
    )
}

export function Skeleton({ className }: { className?: string }) {
    return <div aria-hidden="true" className={cn('animate-pulse rounded bg-grid', className)} />
}

type Tone = 'error' | 'warning' | 'info' | 'success'

const TONES: Record<Tone, { box: string; icon: typeof Info }> = {
    error: { box: 'border-danger/35 bg-danger-soft text-danger-text', icon: XCircle },
    warning: { box: 'border-warn/35 bg-warn-soft text-ink', icon: AlertTriangle },
    info: { box: 'border-rule-strong bg-panel text-ink-2', icon: Info },
    success: { box: 'border-ok/35 bg-ok-soft text-ink', icon: CheckCircle2 },
}

export function Alert({
    tone = 'error',
    title,
    children,
    action,
    className,
}: {
    tone?: Tone
    title?: ReactNode
    children?: ReactNode
    action?: ReactNode
    className?: string
}) {
    const { box, icon: Icon } = TONES[tone]
    return (
        <div
            role={tone === 'error' ? 'alert' : 'status'}
            className={cn(
                'flex items-start gap-2.5 rounded-md border px-3 py-2.5 text-[13px]',
                box,
                className,
            )}
        >
            <Icon
                size={15}
                aria-hidden="true"
                className={cn(
                    'mt-px shrink-0',
                    tone === 'warning' && 'text-warn',
                    tone === 'success' && 'text-ok',
                )}
            />
            <div className="min-w-0 flex-1">
                {title ? <p className="font-medium">{title}</p> : null}
                {children ? (
                    <div className={cn(title && 'mt-0.5 opacity-90')}>{children}</div>
                ) : null}
            </div>
            {action ? <div className="shrink-0">{action}</div> : null}
        </div>
    )
}

export function EmptyState({
    icon,
    title,
    children,
    action,
    className,
}: {
    icon?: ReactNode
    title: string
    children?: ReactNode
    action?: ReactNode
    className?: string
}) {
    return (
        <div
            className={cn(
                'flex flex-col items-center justify-center px-6 py-14 text-center',
                className,
            )}
        >
            {icon ? (
                <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-lg border border-rule bg-panel text-ink-2">
                    {icon}
                </div>
            ) : null}
            <h3 className="text-[15px] font-semibold">{title}</h3>
            {children ? (
                <div className="mt-1.5 max-w-md text-[13px] text-ink-2">{children}</div>
            ) : null}
            {action ? (
                <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>
            ) : null}
        </div>
    )
}

export function LoadingRows({ rows = 4 }: { rows?: number }) {
    return (
        <div className="space-y-2.5 p-4" aria-label="Loading">
            {Array.from({ length: rows }, (_, index) => (
                <Skeleton key={index} className="h-9 w-full" />
            ))}
        </div>
    )
}
