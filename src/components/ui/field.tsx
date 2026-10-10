import {
    forwardRef,
    useId,
    type InputHTMLAttributes,
    type ReactNode,
    type SelectHTMLAttributes,
    type TextareaHTMLAttributes,
} from 'react'
import { cn } from '@/lib/utils'

interface Labelled {
    label: string
    error?: string
    hint?: ReactNode
    className?: string
}

function Wrapper({
    id,
    label,
    error,
    hint,
    className,
    children,
}: Labelled & { id: string; children: ReactNode }) {
    return (
        <div className={className}>
            <label htmlFor={id} className="mb-1.5 block text-[13px] font-medium text-ink-2">
                {label}
            </label>
            {children}
            {error ? (
                <p id={`${id}-error`} className="mt-1.5 text-[12.5px] text-danger">
                    {error}
                </p>
            ) : hint ? (
                <p id={`${id}-hint`} className="mt-1.5 text-[12.5px] text-ink-3">
                    {hint}
                </p>
            ) : null}
        </div>
    )
}

function describedBy(id: string, error?: string, hint?: ReactNode) {
    return error ? `${id}-error` : hint ? `${id}-hint` : undefined
}

export const Field = forwardRef<HTMLInputElement, Labelled & InputHTMLAttributes<HTMLInputElement>>(
    function Field({ label, error, hint, className, id, ...props }, ref) {
        const generated = useId()
        const inputId = id ?? generated
        return (
            <Wrapper id={inputId} label={label} error={error} hint={hint} className={className}>
                <input
                    ref={ref}
                    id={inputId}
                    className="field"
                    aria-invalid={error ? true : undefined}
                    aria-describedby={describedBy(inputId, error, hint)}
                    {...props}
                />
            </Wrapper>
        )
    },
)

export const SelectField = forwardRef<
    HTMLSelectElement,
    Labelled & SelectHTMLAttributes<HTMLSelectElement>
>(function SelectField({ label, error, hint, className, id, children, ...props }, ref) {
    const generated = useId()
    const inputId = id ?? generated
    return (
        <Wrapper id={inputId} label={label} error={error} hint={hint} className={className}>
            <select
                ref={ref}
                id={inputId}
                className="field"
                aria-invalid={error ? true : undefined}
                aria-describedby={describedBy(inputId, error, hint)}
                {...props}
            >
                {children}
            </select>
        </Wrapper>
    )
})

export const TextareaField = forwardRef<
    HTMLTextAreaElement,
    Labelled & TextareaHTMLAttributes<HTMLTextAreaElement>
>(function TextareaField({ label, error, hint, className, id, ...props }, ref) {
    const generated = useId()
    const inputId = id ?? generated
    return (
        <Wrapper id={inputId} label={label} error={error} hint={hint} className={className}>
            <textarea
                ref={ref}
                id={inputId}
                className="field"
                aria-invalid={error ? true : undefined}
                aria-describedby={describedBy(inputId, error, hint)}
                {...props}
            />
        </Wrapper>
    )
})

export function Checkbox({
    label,
    description,
    className,
    ...props
}: { label: ReactNode; description?: ReactNode } & InputHTMLAttributes<HTMLInputElement>) {
    return (
        <label
            className={cn(
                'flex cursor-pointer items-start gap-2.5 text-[13px]',
                props.disabled && 'cursor-not-allowed opacity-60',
                className,
            )}
        >
            <input
                type="checkbox"
                className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[var(--accent)]"
                {...props}
            />
            <span>
                <span className="text-ink">{label}</span>
                {description ? (
                    <span className="block text-[12px] text-ink-3">{description}</span>
                ) : null}
            </span>
        </label>
    )
}
