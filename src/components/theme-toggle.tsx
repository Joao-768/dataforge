'use client'

import { Monitor, Moon, Sun } from 'lucide-react'
import { setThemeMode, useThemeMode, type ThemeMode } from '@/lib/theme'
import { IconButton } from '@/components/ui/button'

const NEXT: Record<ThemeMode, ThemeMode> = { dark: 'light', light: 'system', system: 'dark' }
const LABEL: Record<ThemeMode, string> = {
    system: 'Theme: follows your system',
    light: 'Theme: light',
    dark: 'Theme: dark',
}
const ICON = { system: Monitor, light: Sun, dark: Moon }

// One button that cycles dark, light and system, as in the sibling projects.
export function ThemeToggle() {
    const mode = useThemeMode()
    const Icon = ICON[mode]
    return (
        <IconButton label={`${LABEL[mode]}. Change theme`} onClick={() => setThemeMode(NEXT[mode])}>
            <Icon size={16} aria-hidden="true" />
        </IconButton>
    )
}
