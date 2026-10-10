import Link from 'next/link'
import { forwardRef, type ButtonHTMLAttributes, type ComponentProps } from 'react'
import { cn } from '@/lib/utils'
import { Spinner } from '@/components/ui/feedback'

export type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent'
export type Size = 'xs' | 'sm' | 'md' | 'lg'

const VARIANTS: Record<Variant, string> = {
    primary:
        'bg-ink text-on-ink border border-ink hover:bg-ink-hover hover:border-ink-hover disabled:opacity-45',
    secondary:
        'bg-panel text-ink border border-rule-strong hover:border-ink-3 disabled:text-ink-3 disabled:hover:border-rule-strong',
    ghost: 'text-ink-2 border border-transparent hover:text-ink hover:bg-raised disabled:opacity-45',
    danger: 'bg-danger text-white border border-danger hover:bg-danger-hover disabled:opacity-50',
    accent: 'bg-accent text-on-ink border border-accent hover:brightness-110 disabled:opacity-50',
}

const SIZES: Record<Size, string> = {
    xs: 'h-7 px-2 text-xs gap-1',
    sm: 'h-8 px-3 text-[13px] gap-1.5',
    md: 'h-9 px-3.5 text-sm gap-2',
    lg: 'h-11 px-5 text-[15px] gap-2',
}

export function buttonClass(variant: Variant = 'secondary', size: Size = 'md', className?: string) {
    return cn(
        'inline-flex shrink-0 items-center justify-center rounded-md font-medium whitespace-nowrap transition-colors duration-150 select-none',
        VARIANTS[variant],
        SIZES[size],
        className,
    )
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: Variant
    size?: Size
    busy?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
    { variant, size, busy, className, children, disabled, type = 'button', ...props },
    ref,
) {
    return (
        <button
            ref={ref}
            type={type}
            className={buttonClass(variant, size, className)}
            disabled={disabled || busy}
            aria-busy={busy || undefined}
            {...props}
        >
            {busy ? <Spinner /> : null}
            {children}
        </button>
    )
})

export function ButtonLink({
    variant,
    size,
    className,
    ...props
}: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
    return <Link className={buttonClass(variant, size, className)} {...props} />
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    label: string
    size?: 'sm' | 'md'
    active?: boolean
}

/** Square icon-only button; `label` becomes the accessible name and tooltip. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
    { label, size = 'md', active, className, children, type = 'button', ...props },
    ref,
) {
    return (
        <button
            ref={ref}
            type={type}
            aria-label={label}
            title={label}
            className={cn(
                'inline-flex shrink-0 items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-raised hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent',
                size === 'sm' ? 'h-7 w-7' : 'h-8 w-8',
                active && 'bg-raised text-ink',
                className,
            )}
            {...props}
        >
            {children}
        </button>
    )
})
