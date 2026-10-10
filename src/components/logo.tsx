import { cn } from '@/lib/utils'

// Wordmark: a table glyph whose header row glows ember, then the name with
// the second half in a lighter weight, like Pulse Monitor's "pulse monitor".
export function LogoMark({ className }: { className?: string }) {
    return (
        <svg viewBox="0 0 20 20" className={cn('h-5 w-5', className)} aria-hidden="true">
            <rect x="1.5" y="2.5" width="17" height="4" rx="1.4" fill="var(--accent)" />
            <rect x="1.5" y="8.25" width="17" height="4" rx="1.4" fill="currentColor" />
            <rect x="1.5" y="14" width="11" height="4" rx="1.4" fill="currentColor" />
        </svg>
    )
}

export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
    return (
        <span className={cn('inline-flex items-center gap-2 text-ink', className)}>
            <LogoMark />
            {compact ? null : (
                <span className="text-[16px] font-semibold tracking-[-0.02em]">
                    data<span className="font-light text-ink-3">forge</span>
                </span>
            )}
        </span>
    )
}
