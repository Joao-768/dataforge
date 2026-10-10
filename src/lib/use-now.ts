'use client'

import { useSyncExternalStore } from 'react'

// The current time as an external store: components re-render on the
// interval, the server snapshot is null (no clock-dependent markup during
// hydration), and render functions stay pure.

const listeners = new Set<() => void>()
let now = 0
let timer: ReturnType<typeof setInterval> | undefined

function subscribe(listener: () => void) {
    listeners.add(listener)
    if (!timer) {
        now = Date.now()
        timer = setInterval(() => {
            now = Date.now()
            listeners.forEach((notify) => notify())
        }, 250)
    }
    return () => {
        listeners.delete(listener)
        if (listeners.size === 0 && timer) {
            clearInterval(timer)
            timer = undefined
        }
    }
}

export function useNow(): number | null {
    return useSyncExternalStore(
        subscribe,
        () => now || null,
        () => null,
    )
}
