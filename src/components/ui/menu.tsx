'use client'

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface MenuItem {
    label: ReactNode
    icon?: ReactNode
    onSelect: () => void
    tone?: 'default' | 'danger'
    disabled?: boolean
    hint?: ReactNode
}

/**
 * Dropdown menu with menu-button semantics: arrow keys move between items,
 * Escape closes and returns focus to the trigger.
 */
export function Menu({
    trigger,
    items,
    align = 'end',
    label,
}: {
    trigger: (props: {
        open: boolean
        toggle: () => void
        ref: React.Ref<HTMLButtonElement>
        id: string
    }) => ReactNode
    items: (MenuItem | 'separator')[]
    align?: 'start' | 'end'
    label: string
}) {
    const [open, setOpen] = useState(false)
    const triggerRef = useRef<HTMLButtonElement>(null)
    const listRef = useRef<HTMLDivElement>(null)
    const id = useId()

    useEffect(() => {
        if (!open) return
        const first = listRef.current?.querySelector<HTMLButtonElement>(
            '[role="menuitem"]:not([disabled])',
        )
        first?.focus()
        const onPointer = (event: PointerEvent) => {
            if (
                !listRef.current?.contains(event.target as Node) &&
                !triggerRef.current?.contains(event.target as Node)
            ) {
                setOpen(false)
            }
        }
        document.addEventListener('pointerdown', onPointer)
        return () => document.removeEventListener('pointerdown', onPointer)
    }, [open])

    const close = () => {
        setOpen(false)
        triggerRef.current?.focus()
    }

    const onKeyDown = (event: React.KeyboardEvent) => {
        const options = [
            ...(listRef.current?.querySelectorAll<HTMLButtonElement>(
                '[role="menuitem"]:not([disabled])',
            ) ?? []),
        ]
        const index = options.indexOf(document.activeElement as HTMLButtonElement)
        if (event.key === 'Escape') {
            event.preventDefault()
            close()
        } else if (event.key === 'ArrowDown') {
            event.preventDefault()
            options[(index + 1) % options.length]?.focus()
        } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            options[(index - 1 + options.length) % options.length]?.focus()
        } else if (event.key === 'Tab') {
            setOpen(false)
        }
    }

    return (
        <div className="relative">
            {trigger({ open, toggle: () => setOpen((value) => !value), ref: triggerRef, id })}
            {open ? (
                <div
                    ref={listRef}
                    role="menu"
                    aria-label={label}
                    aria-labelledby={id}
                    onKeyDown={onKeyDown}
                    className={cn(
                        'absolute top-[calc(100%+6px)] z-50 min-w-[13rem] animate-rise rounded-lg border border-rule bg-panel p-1 shadow-xl shadow-black/30',
                        align === 'end' ? 'right-0' : 'left-0',
                    )}
                >
                    {items.map((item, index) =>
                        item === 'separator' ? (
                            <div
                                key={`separator-${index}`}
                                role="separator"
                                className="my-1 h-px bg-rule"
                            />
                        ) : (
                            <button
                                key={index}
                                type="button"
                                role="menuitem"
                                disabled={item.disabled}
                                onClick={() => {
                                    setOpen(false)
                                    item.onSelect()
                                }}
                                className={cn(
                                    'flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] outline-none hover:bg-raised focus-visible:bg-raised disabled:opacity-40',
                                    item.tone === 'danger' ? 'text-danger' : 'text-ink',
                                )}
                            >
                                {item.icon ? <span className="text-ink-3">{item.icon}</span> : null}
                                <span className="flex-1">{item.label}</span>
                                {item.hint ? (
                                    <span className="text-[11px] text-ink-3">{item.hint}</span>
                                ) : null}
                            </button>
                        ),
                    )}
                </div>
            ) : null}
        </div>
    )
}
