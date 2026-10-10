// Theme preference: dark by default; 'light' overrides it and 'system'
// follows the OS. public/theme.js applies the saved choice before React
// loads; this module keeps it in sync afterwards.

import { useSyncExternalStore } from 'react'

export type ThemeMode = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'dataforge-theme'
const listeners = new Set<() => void>()

function media() {
    return window.matchMedia('(prefers-color-scheme: dark)')
}

export function readThemeMode(): ThemeMode {
    if (typeof window === 'undefined') return 'dark'
    try {
        const saved = localStorage.getItem(STORAGE_KEY)
        return saved === 'light' || saved === 'system' ? saved : 'dark'
    } catch {
        return 'dark'
    }
}

function apply(mode: ThemeMode) {
    const dark = mode === 'dark' || (mode === 'system' && media().matches)
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
    listeners.forEach((listener) => listener())
}

export function setThemeMode(mode: ThemeMode) {
    try {
        localStorage.setItem(STORAGE_KEY, mode)
    } catch {
        // Storage unavailable (private mode): the choice lasts for this page only.
    }
    apply(mode)
}

function subscribe(listener: () => void) {
    listeners.add(listener)
    const query = media()
    const onChange = () => {
        if (readThemeMode() === 'system') apply('system')
    }
    query.addEventListener('change', onChange)
    return () => {
        listeners.delete(listener)
        query.removeEventListener('change', onChange)
    }
}

export function useThemeMode(): ThemeMode {
    return useSyncExternalStore(subscribe, readThemeMode, () => 'dark')
}

/** The theme actually shown (system resolved), for Monaco and the canvas. */
export function useResolvedTheme(): 'light' | 'dark' {
    const mode = useThemeMode()
    return useSyncExternalStore(
        subscribe,
        () => (document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'),
        () => (mode === 'light' ? 'light' : 'dark'),
    )
}
