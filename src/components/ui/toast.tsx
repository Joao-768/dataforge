'use client'

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

// Toasts, in the shared style: an ink-on-paper pill at the bottom of the
// screen with a status dot. Errors stay longer than confirmations.

type Tone = 'neutral' | 'success' | 'error'

interface Toast {
    id: number
    message: string
    tone: Tone
}

type Show = (message: string, tone?: Tone) => void

const ToastContext = createContext<Show>(() => undefined)

let nextId = 1

export function ToastProvider({ children }: { children: ReactNode }) {
    const [toasts, setToasts] = useState<Toast[]>([])

    const show = useCallback<Show>((message, tone = 'neutral') => {
        const id = nextId++
        setToasts((current) => [...current.slice(-2), { id, message, tone }])
        window.setTimeout(
            () => setToasts((current) => current.filter((toast) => toast.id !== id)),
            tone === 'error' ? 7000 : 4000,
        )
    }, [])

    return (
        <ToastContext.Provider value={show}>
            {children}
            <div
                aria-live="polite"
                className="pointer-events-none fixed inset-x-0 bottom-5 z-[60] flex flex-col items-center gap-2 px-4"
            >
                {toasts.map((toast) => (
                    <div
                        key={toast.id}
                        role={toast.tone === 'error' ? 'alert' : 'status'}
                        className={cn(
                            'pointer-events-auto flex max-w-[min(36rem,100%)] animate-rise items-center gap-2.5 rounded-md px-3.5 py-2.5 text-[13px] shadow-lg shadow-black/25',
                            toast.tone === 'error' ? 'bg-danger text-white' : 'bg-ink text-on-ink',
                        )}
                    >
                        <span
                            className={cn(
                                'h-1.5 w-1.5 shrink-0 rounded-full',
                                toast.tone === 'error'
                                    ? 'bg-white'
                                    : toast.tone === 'success'
                                      ? 'bg-ok'
                                      : 'bg-accent',
                            )}
                        />
                        {toast.message}
                    </div>
                ))}
            </div>
        </ToastContext.Provider>
    )
}

export function useToast(): Show {
    return useContext(ToastContext)
}
