import Link from 'next/link'
import type { ReactNode } from 'react'
import { Logo } from '@/components/logo'
import { ThemeToggle } from '@/components/theme-toggle'

export function AuthShell({
    title,
    description,
    children,
    footer,
}: {
    title: string
    description?: ReactNode
    children: ReactNode
    footer?: ReactNode
}) {
    return (
        <div className="blueprint flex min-h-svh flex-col">
            <header className="flex h-14 items-center justify-between px-5">
                <Link href="/" aria-label="DataForge home" className="rounded">
                    <Logo />
                </Link>
                <ThemeToggle />
            </header>
            <main className="flex flex-1 items-center justify-center px-4 pb-16">
                <div className="w-full max-w-[24rem] animate-rise">
                    <div className="rounded-lg border border-rule bg-panel p-6 shadow-xl shadow-black/10">
                        <h1 className="text-[19px] font-semibold tracking-[-0.015em]">{title}</h1>
                        {description ? (
                            <p className="mt-1 text-[13px] text-ink-2">{description}</p>
                        ) : null}
                        <div className="mt-5">{children}</div>
                    </div>
                    {footer ? (
                        <div className="mt-4 text-center text-[13px] text-ink-2">{footer}</div>
                    ) : null}
                </div>
            </main>
        </div>
    )
}
