'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// Native <dialog>: focus trapping, Escape and the backdrop come from the
// browser, like Pulse Monitor's dialogs.
export function Dialog({
    open,
    onClose,
    title,
    description,
    children,
    footer,
    size = 'md',
}: {
    open: boolean
    onClose: () => void
    title: ReactNode
    description?: ReactNode
    children?: ReactNode
    footer?: ReactNode
    size?: 'sm' | 'md' | 'lg' | 'xl'
}) {
    const ref = useRef<HTMLDialogElement>(null)

    useEffect(() => {
        const dialog = ref.current
        if (!dialog) return
        if (open && !dialog.open) dialog.showModal()
        if (!open && dialog.open) dialog.close()
    }, [open])

    const width = { sm: '26rem', md: '32rem', lg: '44rem', xl: '60rem' }[size]

    return (
        <dialog
            ref={ref}
            onClose={onClose}
            onCancel={(event) => {
                event.preventDefault()
                onClose()
            }}
            onMouseDown={(event) => {
                if (event.target === ref.current) onClose()
            }}
            style={{ width: `min(100vw - 2rem, ${width})` }}
            className="m-auto max-h-[min(100svh-2rem,52rem)] rounded-lg border border-rule bg-panel p-0 text-ink shadow-2xl shadow-black/40 backdrop:bg-scrim open:animate-rise"
        >
            {open ? (
                <div className="flex max-h-[inherit] flex-col">
                    <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-4">
                        <div className="min-w-0">
                            <h2 className="text-[16px] font-semibold tracking-[-0.01em]">
                                {title}
                            </h2>
                            {description ? (
                                <div className="mt-1 text-[13px] text-ink-2">{description}</div>
                            ) : null}
                        </div>
                        <button
                            type="button"
                            onClick={onClose}
                            className="-mt-1 -mr-2 rounded p-1.5 text-ink-3 hover:bg-raised hover:text-ink"
                            aria-label="Close"
                        >
                            <X size={17} />
                        </button>
                    </div>
                    {children ? (
                        <div className="min-h-0 overflow-y-auto px-5 pb-5">{children}</div>
                    ) : null}
                    {footer ? (
                        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-rule px-5 py-3.5">
                            {footer}
                        </div>
                    ) : null}
                </div>
            ) : null}
        </dialog>
    )
}

/**
 * Confirmation for consequential actions. With `confirmText`, the user has
 * to type it back before the button enables (deleting a project, applying a
 * destructive migration).
 */
export function ConfirmDialog({
    open,
    onClose,
    onConfirm,
    title,
    children,
    confirmLabel,
    confirmText,
    tone = 'danger',
    busy = false,
}: {
    open: boolean
    onClose: () => void
    onConfirm: () => void
    title: string
    children?: ReactNode
    confirmLabel: string
    confirmText?: string
    tone?: 'danger' | 'primary'
    busy?: boolean
}) {
    const [typed, setTyped] = useState('')
    const ready = !confirmText || typed.trim() === confirmText

    useEffect(() => {
        if (!open) setTyped('')
    }, [open])

    return (
        <Dialog
            open={open}
            onClose={onClose}
            title={title}
            size="sm"
            footer={
                <>
                    <Button variant="ghost" onClick={onClose} disabled={busy}>
                        Cancel
                    </Button>
                    <Button
                        variant={tone === 'danger' ? 'danger' : 'primary'}
                        onClick={onConfirm}
                        disabled={!ready}
                        busy={busy}
                    >
                        {confirmLabel}
                    </Button>
                </>
            }
        >
            <div className="space-y-3 text-[13.5px] text-ink-2">{children}</div>
            {confirmText ? (
                <div className="mt-4">
                    <label className="mb-1.5 block text-[12.5px] text-ink-2">
                        Type <span className="font-mono font-medium text-ink">{confirmText}</span>{' '}
                        to confirm
                    </label>
                    <input
                        className={cn('field mono')}
                        value={typed}
                        onChange={(event) => setTyped(event.target.value)}
                        autoComplete="off"
                        spellCheck={false}
                        aria-label={`Type ${confirmText} to confirm`}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter' && ready && !busy) onConfirm()
                        }}
                    />
                </div>
            ) : null}
        </Dialog>
    )
}
