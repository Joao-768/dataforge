'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
    Activity,
    ArrowUpRight,
    Database,
    GitBranch,
    MoreHorizontal,
    PenLine,
    Plus,
    Table2,
    Terminal,
    Trash2,
} from 'lucide-react'
import { useSessionUser } from '@/components/session'
import { Button, IconButton } from '@/components/ui/button'
import { Alert, EmptyState, Skeleton } from '@/components/ui/feedback'
import { Menu } from '@/components/ui/menu'
import { PageHeader, Panel, PanelHeader } from '@/components/ui/panel'
import { api } from '@/lib/api'
import { formatRelative, pluralize } from '@/lib/format'
import type { ProjectSummary } from '@/server/projects/service'
import { DatabaseStatus } from '@/features/projects/database-status'
import {
    CreateProjectDialog,
    DeleteProjectDialog,
    RenameProjectDialog,
} from '@/features/projects/project-dialogs'

interface ProjectsResponse {
    projects: ProjectSummary[]
    activity: {
        id: string
        projectId: string | null
        projectName: string | null
        message: string
        createdAt: string
        kind: string
    }[]
}

export function Dashboard() {
    const user = useSessionUser()
    const params = useSearchParams()
    const [creating, setCreating] = useState(false)
    const [renaming, setRenaming] = useState<ProjectSummary | null>(null)
    const [deleting, setDeleting] = useState<ProjectSummary | null>(null)
    const { data, isLoading, error, refetch } = useQuery({
        queryKey: ['projects'],
        queryFn: () => api<ProjectsResponse>('/api/projects'),
    })

    const projects = data?.projects ?? []
    const welcome = params.get('welcome') === '1'

    return (
        <main className="mx-auto w-full max-w-[1200px] flex-1 px-4 pt-8 pb-16 sm:px-6">
            <PageHeader
                eyebrow={user.isGuest ? 'Demo workspace' : 'Workspace'}
                title="Projects"
                description="Each project owns one PostgreSQL database, its schema history and its queries."
                actions={
                    <Button variant="primary" onClick={() => setCreating(true)}>
                        <Plus size={15} aria-hidden="true" /> New project
                    </Button>
                }
            />

            {welcome ? (
                <Alert
                    tone="success"
                    title={`Welcome, ${user.name.split(' ')[0]}`}
                    className="mb-6"
                >
                    Start with a sandbox that already has sample data, or an empty one to design
                    from scratch.
                </Alert>
            ) : null}
            {user.isGuest ? (
                <Alert tone="info" className="mb-6" title="You are in a private demo">
                    Everything here, including the database, belongs to this browser session only.
                    Change anything: write queries, migrations and imports all run against your own
                    copy. It is removed automatically after a day.
                </Alert>
            ) : null}

            {error ? (
                <Alert
                    action={
                        <Button size="sm" onClick={() => refetch()}>
                            Retry
                        </Button>
                    }
                >
                    Could not load your projects.
                </Alert>
            ) : null}

            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
                <section aria-label="Projects">
                    {isLoading ? (
                        <div className="grid gap-4 sm:grid-cols-2">
                            {[0, 1].map((index) => (
                                <Skeleton key={index} className="h-[172px] rounded-lg" />
                            ))}
                        </div>
                    ) : projects.length === 0 ? (
                        <Onboarding onCreate={() => setCreating(true)} />
                    ) : (
                        <div className="grid gap-4 sm:grid-cols-2">
                            {projects.map((project) => (
                                <ProjectCard
                                    key={project.id}
                                    project={project}
                                    onRename={() => setRenaming(project)}
                                    onDelete={() => setDeleting(project)}
                                />
                            ))}
                        </div>
                    )}
                </section>

                <Panel className="h-fit">
                    <PanelHeader title="Recent activity" eyebrow="Across projects" />
                    {isLoading ? (
                        <div className="space-y-3 p-4">
                            {[0, 1, 2].map((index) => (
                                <Skeleton key={index} className="h-8" />
                            ))}
                        </div>
                    ) : (data?.activity.length ?? 0) === 0 ? (
                        <p className="px-4 py-6 text-[13px] text-ink-3">
                            Nothing yet. Activity shows up as you work.
                        </p>
                    ) : (
                        <ol className="rows">
                            {data!.activity.map((entry) => (
                                <li key={entry.id} className="px-4 py-2.5">
                                    <p className="text-[13px] leading-snug">{entry.message}</p>
                                    <p className="mt-0.5 font-mono text-[11px] text-ink-3">
                                        {entry.projectName ? `${entry.projectName} · ` : ''}
                                        {formatRelative(entry.createdAt)}
                                    </p>
                                </li>
                            ))}
                        </ol>
                    )}
                </Panel>
            </div>

            <CreateProjectDialog open={creating} onClose={() => setCreating(false)} />
            <RenameProjectDialog project={renaming} onClose={() => setRenaming(null)} />
            <DeleteProjectDialog project={deleting} onClose={() => setDeleting(null)} />
        </main>
    )
}

function ProjectCard({
    project,
    onRename,
    onDelete,
}: {
    project: ProjectSummary
    onRename: () => void
    onDelete: () => void
}) {
    return (
        <article className="group relative flex flex-col rounded-lg border border-rule bg-panel transition-colors hover:border-rule-strong">
            <div className="flex items-start justify-between gap-3 px-4 pt-4">
                <div className="min-w-0">
                    <h2 className="truncate text-[15px] font-semibold">
                        <Link
                            href={`/projects/${project.id}`}
                            className="rounded outline-offset-4 after:absolute after:inset-0 after:content-['']"
                        >
                            {project.name}
                        </Link>
                    </h2>
                    <p className="mt-0.5 line-clamp-2 min-h-[2.5em] text-[13px] text-ink-3">
                        {project.description || 'No description'}
                    </p>
                </div>
                <div className="relative z-10">
                    <Menu
                        label={`${project.name} actions`}
                        trigger={({ toggle, ref, id, open }) => (
                            <IconButton
                                ref={ref}
                                id={id}
                                label="Project actions"
                                onClick={toggle}
                                aria-haspopup="menu"
                                aria-expanded={open}
                                size="sm"
                            >
                                <MoreHorizontal size={16} />
                            </IconButton>
                        )}
                        items={[
                            { label: 'Rename', icon: <PenLine size={14} />, onSelect: onRename },
                            'separator',
                            {
                                label: 'Delete project',
                                icon: <Trash2 size={14} />,
                                tone: 'danger',
                                onSelect: onDelete,
                            },
                        ]}
                    />
                </div>
            </div>
            <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-rule px-4 py-3">
                <div>
                    <dt className="eyebrow">Database</dt>
                    <dd className="mt-1">
                        <DatabaseStatus database={project.database} />
                    </dd>
                </div>
                <div>
                    <dt className="eyebrow">Tables</dt>
                    <dd className="mt-1 text-[14px] font-medium tabular-nums">
                        {project.database?.tableCount ?? (project.database ? '…' : 'none')}
                    </dd>
                </div>
                <div>
                    <dt className="eyebrow">Schema changed</dt>
                    <dd
                        className="mt-1 truncate text-[13px] text-ink-2"
                        title={project.schemaChangedAt ?? undefined}
                    >
                        {project.schemaChangedAt
                            ? formatRelative(project.schemaChangedAt)
                            : 'not yet'}
                    </dd>
                </div>
            </dl>
            <div className="flex items-center justify-between border-t border-rule px-4 py-2 font-mono text-[11px] text-ink-3">
                <span>
                    {project.lastActivityAt
                        ? `Active ${formatRelative(project.lastActivityAt)}`
                        : `Created ${formatRelative(project.createdAt)}`}
                </span>
                <ArrowUpRight
                    size={13}
                    className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                    aria-hidden="true"
                />
            </div>
        </article>
    )
}

function Onboarding({ onCreate }: { onCreate: () => void }) {
    const steps = [
        {
            icon: Database,
            title: 'Create a project',
            text: 'DataForge provisions a private PostgreSQL database for it in a second.',
        },
        {
            icon: Table2,
            title: 'Design the schema',
            text: 'Draw tables, keys and relationships on the canvas.',
        },
        {
            icon: GitBranch,
            title: 'Migrate',
            text: 'Review the generated SQL, then apply it in one transaction.',
        },
        {
            icon: Terminal,
            title: 'Query and explore',
            text: 'Run SQL, read plans and browse rows.',
        },
    ]
    return (
        <Panel className="blueprint overflow-hidden">
            <EmptyState
                icon={<Activity size={18} />}
                title="No projects yet"
                action={
                    <Button variant="primary" onClick={onCreate}>
                        <Plus size={15} aria-hidden="true" /> Create your first project
                    </Button>
                }
            >
                {pluralize(0, 'project')} so far. Here is how a project comes together:
            </EmptyState>
            <ol className="grid gap-px border-t border-rule bg-rule sm:grid-cols-2">
                {steps.map((step, index) => (
                    <li key={step.title} className="flex gap-3 bg-panel px-4 py-3.5">
                        <span className="font-mono text-[11px] text-accent">0{index + 1}</span>
                        <div>
                            <p className="flex items-center gap-1.5 text-[13.5px] font-medium">
                                <step.icon size={14} className="text-ink-3" aria-hidden="true" />{' '}
                                {step.title}
                            </p>
                            <p className="mt-0.5 text-[12.5px] text-ink-3">{step.text}</p>
                        </div>
                    </li>
                ))}
            </ol>
        </Panel>
    )
}
