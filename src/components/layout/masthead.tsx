'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Keyboard, LogOut, Settings, UserRound } from 'lucide-react'
import { Logo } from '@/components/logo'
import { useSessionUser } from '@/components/session'
import { ThemeToggle } from '@/components/theme-toggle'
import { Badge } from '@/components/ui/badge'
import { Menu } from '@/components/ui/menu'
import { ShortcutsDialog } from '@/components/layout/shortcuts'
import { api } from '@/lib/api'
import { useNow } from '@/lib/use-now'
import { cn } from '@/lib/utils'

function hoursLeft(expiresAt: string | null, now: number): number | null {
    if (!expiresAt) return null
    return Math.max(0, Math.round((new Date(expiresAt).getTime() - now) / 3_600_000))
}

export function Masthead() {
    const user = useSessionUser()
    const router = useRouter()
    const pathname = usePathname()
    const [shortcuts, setShortcuts] = useState(false)
    const now = useNow()
    const remaining = now === null ? null : hoursLeft(user.expiresAt, now)

    // "?" opens the shortcut reference from anywhere outside a text field.
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement
            const typing = target.closest(
                'input, textarea, select, [contenteditable="true"], .monaco-editor',
            )
            if (event.key === '?' && !typing && !event.metaKey && !event.ctrlKey) {
                event.preventDefault()
                setShortcuts(true)
            }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [])

    async function signOut() {
        await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined)
        router.push(user.isGuest ? '/' : '/login')
        router.refresh()
    }

    const nav = [
        { href: '/projects', label: 'Projects' },
        { href: '/settings', label: 'Settings' },
    ]

    return (
        <header className="sticky top-0 z-40 border-b border-rule bg-paper/95 backdrop-blur supports-[backdrop-filter]:bg-paper/80">
            <div className="flex h-[var(--masthead-height)] items-center gap-6 px-4 sm:px-5">
                <Link href="/" aria-label="DataForge home" className="flex items-center rounded">
                    <Logo />
                </Link>
                <nav aria-label="Main" className="hidden h-full items-center gap-5 sm:flex">
                    {nav.map((item) => {
                        const active =
                            pathname === item.href ||
                            (item.href === '/projects' && pathname.startsWith('/projects'))
                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                aria-current={active ? 'page' : undefined}
                                className={cn(
                                    'relative flex h-full items-center text-[13.5px] transition-colors',
                                    active
                                        ? 'text-ink after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:bg-accent'
                                        : 'text-ink-3 hover:text-ink',
                                )}
                            >
                                {item.label}
                            </Link>
                        )
                    })}
                </nav>
                <div className="ml-auto flex items-center gap-1.5">
                    {user.isGuest ? (
                        <Badge tone="accent" className="mr-2 hidden md:inline-flex">
                            Demo{remaining !== null ? ` · resets in ${remaining}h` : ''}
                        </Badge>
                    ) : null}
                    <ThemeToggle />
                    <Menu
                        label="Account"
                        trigger={({ toggle, ref, id, open }) => (
                            <button
                                ref={ref}
                                id={id}
                                type="button"
                                onClick={toggle}
                                aria-haspopup="menu"
                                aria-expanded={open}
                                className="ml-1 flex h-8 items-center gap-2 rounded-md px-1.5 text-[13px] text-ink-2 hover:bg-raised hover:text-ink"
                            >
                                <span className="flex h-6 w-6 items-center justify-center rounded-full border border-rule-strong bg-panel font-mono text-[10.5px] text-ink">
                                    {user.isGuest ? (
                                        <UserRound size={13} />
                                    ) : (
                                        user.name.slice(0, 1).toUpperCase()
                                    )}
                                </span>
                                <span className="hidden max-w-[10rem] truncate md:inline">
                                    {user.name}
                                </span>
                            </button>
                        )}
                        items={[
                            {
                                label: 'Account settings',
                                icon: <Settings size={14} />,
                                onSelect: () => router.push('/settings'),
                            },
                            {
                                label: 'Keyboard shortcuts',
                                icon: <Keyboard size={14} />,
                                hint: '?',
                                onSelect: () => setShortcuts(true),
                            },
                            'separator',
                            {
                                label: user.isGuest ? 'End demo' : 'Sign out',
                                icon: <LogOut size={14} />,
                                onSelect: signOut,
                            },
                        ]}
                    />
                </div>
            </div>
            <ShortcutsDialog open={shortcuts} onClose={() => setShortcuts(false)} />
        </header>
    )
}
