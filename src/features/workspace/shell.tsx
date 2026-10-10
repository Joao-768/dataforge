'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, type ReactNode } from 'react'
import {
    BarChart3,
    ChevronRight,
    Database,
    FileUp,
    GitBranch,
    LayoutDashboard,
    Settings,
    Table2,
    Terminal,
    Workflow,
} from 'lucide-react'
import { Skeleton } from '@/components/ui/feedback'
import { cn } from '@/lib/utils'
import { ProjectProvider, useProject } from '@/features/workspace/context'
import { DatabaseStatus } from '@/features/projects/database-status'

export const SECTIONS = [
    { path: '', label: 'Overview', icon: LayoutDashboard },
    { path: '/designer', label: 'Designer', icon: Workflow },
    { path: '/sql', label: 'SQL', icon: Terminal },
    { path: '/data', label: 'Data', icon: Table2 },
    { path: '/migrations', label: 'Migrations', icon: GitBranch },
    { path: '/analytics', label: 'Analytics', icon: BarChart3 },
    { path: '/transfer', label: 'Import / Export', icon: FileUp },
    { path: '/settings', label: 'Settings', icon: Settings },
] as const

export function WorkspaceShell({
    projectId,
    children,
}: {
    projectId: string
    children: ReactNode
}) {
    return (
        <ProjectProvider projectId={projectId}>
            <ProjectBar projectId={projectId} />
            <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        </ProjectProvider>
    )
}

function ProjectBar({ projectId }: { projectId: string }) {
    const pathname = usePathname()
    const router = useRouter()
    const { data } = useProject()
    const base = `/projects/${projectId}`

    // Alt+1..8 switches section.
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (!event.altKey || event.metaKey || event.ctrlKey) return
            const index = Number(event.code.replace('Digit', '')) - 1
            const section = SECTIONS[index]
            if (section && /^Digit[1-8]$/.test(event.code)) {
                event.preventDefault()
                router.push(`${base}${section.path}`)
            }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [base, router])

    return (
        <div className="sticky top-[var(--masthead-height)] z-30 border-b border-rule bg-paper">
            <div className="flex h-11 items-center gap-2 px-4 sm:px-5">
                <nav
                    aria-label="Breadcrumb"
                    className="flex min-w-0 items-center gap-1.5 text-[13px]"
                >
                    <Link href="/projects" className="text-ink-3 hover:text-ink">
                        Projects
                    </Link>
                    <ChevronRight size={13} className="shrink-0 text-ink-3" aria-hidden="true" />
                    {data ? (
                        <span className="truncate font-medium">{data.project.name}</span>
                    ) : (
                        <Skeleton className="h-4 w-28" />
                    )}
                </nav>
                {data ? (
                    <span className="ml-1 hidden sm:inline-flex">
                        <DatabaseStatus database={data.project.database} />
                    </span>
                ) : null}
                {data?.connection ? (
                    <span className="ml-auto hidden items-center gap-1.5 font-mono text-[11px] text-ink-3 md:flex">
                        <Database size={12} aria-hidden="true" />
                        {data.connection.database}
                        {data.connection.serverVersion
                            ? ` · PostgreSQL ${data.connection.serverVersion.split(' ')[0]}`
                            : ''}
                    </span>
                ) : null}
            </div>
            <nav
                aria-label="Project sections"
                className="scrollbar-thin flex h-[var(--tabs-height)] items-stretch gap-1 overflow-x-auto px-3 sm:px-4"
            >
                {SECTIONS.map((section, index) => {
                    const href = `${base}${section.path}`
                    const active =
                        section.path === '' ? pathname === base : pathname.startsWith(href)
                    return (
                        <Link
                            key={section.label}
                            href={href}
                            aria-current={active ? 'page' : undefined}
                            title={`${section.label} (Alt+${index + 1})`}
                            className={cn(
                                'relative flex shrink-0 items-center gap-1.5 rounded-sm px-2.5 text-[13px] whitespace-nowrap transition-colors',
                                active
                                    ? 'text-ink after:absolute after:inset-x-2 after:bottom-0 after:h-[2px] after:bg-accent'
                                    : 'text-ink-3 hover:text-ink',
                            )}
                        >
                            <section.icon size={14} aria-hidden="true" />
                            {section.label}
                        </Link>
                    )
                })}
            </nav>
        </div>
    )
}
