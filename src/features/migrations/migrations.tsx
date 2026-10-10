'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
    AlertTriangle,
    CheckCircle2,
    CircleDashed,
    GitBranch,
    Loader2,
    Play,
    Trash2,
    Workflow,
    XCircle,
} from 'lucide-react'
import { SqlBlock } from '@/components/sql-block'
import { Badge, type BadgeTone } from '@/components/ui/badge'
import { Button, ButtonLink } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/dialog'
import { Alert, EmptyState, LoadingRows } from '@/components/ui/feedback'
import { Panel, PanelHeader } from '@/components/ui/panel'
import { useToast } from '@/components/ui/toast'
import { api, ApiError, projectApi } from '@/lib/api'
import { formatDateTime, formatDuration, formatRelative } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { DraftState, Migration } from '@/server/migrations/service'
import { useProjectId } from '@/features/workspace/context'
import { ReviewDialog } from '@/features/designer/designer'

const STATUS: Record<
    Migration['status'],
    { label: string; tone: BadgeTone; icon: typeof CheckCircle2 }
> = {
    draft: { label: 'Draft', tone: 'neutral', icon: CircleDashed },
    applying: { label: 'Applying', tone: 'warn', icon: Loader2 },
    applied: { label: 'Applied', tone: 'ok', icon: CheckCircle2 },
    failed: { label: 'Failed', tone: 'danger', icon: XCircle },
}

export function Migrations() {
    const projectId = useProjectId()
    const router = useRouter()
    const pathname = usePathname()
    const params = useSearchParams()
    const [reviewing, setReviewing] = useState(false)
    const migrations = useQuery({
        queryKey: ['migrations', projectId],
        queryFn: () => api<{ migrations: Migration[] }>(projectApi(projectId, '/migrations')),
        refetchInterval: (query) =>
            query.state.data?.migrations.some((migration) => migration.status === 'applying')
                ? 3000
                : false,
    })
    const draft = useQuery({
        queryKey: ['draft', projectId],
        queryFn: () => api<DraftState>(projectApi(projectId, '/draft')),
    })

    const list = migrations.data?.migrations ?? []
    const selectedId = params.get('migration') ?? list[0]?.id ?? null
    const selected = list.find((migration) => migration.id === selectedId) ?? null
    const select = (id: string) => router.replace(`${pathname}?migration=${id}`)

    return (
        <main className="mx-auto w-full max-w-[1300px] px-4 pt-6 pb-16 sm:px-6">
            <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
                <div>
                    <p className="eyebrow mb-1.5">Schema versioning</p>
                    <h1 className="text-[22px] font-semibold tracking-[-0.015em]">Migrations</h1>
                    <p className="mt-1 max-w-2xl text-[13.5px] text-ink-2">
                        Each migration is generated from the designer draft, reviewed as SQL, and
                        applied in a single transaction. A migration is marked applied only after
                        PostgreSQL confirms the commit.
                    </p>
                </div>
            </div>

            {draft.data?.dirty ? (
                <Panel className="mb-6 flex flex-wrap items-center gap-4 border-accent/40 px-4 py-3">
                    <GitBranch size={16} className="text-accent" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                        <p className="text-[13.5px] font-medium">
                            The designer draft has changes that are not in the database yet
                        </p>
                        <p className="text-[12.5px] text-ink-3">
                            Generate a migration to review them as SQL.
                        </p>
                    </div>
                    <ButtonLink href={`/projects/${projectId}/designer`} size="sm">
                        <Workflow size={13} /> Open designer
                    </ButtonLink>
                    <Button
                        size="sm"
                        variant="primary"
                        onClick={() => setReviewing(true)}
                        disabled={draft.data.stale}
                    >
                        Generate migration
                    </Button>
                </Panel>
            ) : null}

            {migrations.isLoading ? (
                <LoadingRows rows={5} />
            ) : list.length === 0 ? (
                <Panel className="blueprint">
                    <EmptyState
                        icon={<GitBranch size={18} />}
                        title="No migrations yet"
                        action={
                            <ButtonLink href={`/projects/${projectId}/designer`} variant="primary">
                                Open the designer
                            </ButtonLink>
                        }
                    >
                        Change the schema on the canvas, then choose “Review migration”.
                    </EmptyState>
                </Panel>
            ) : (
                <div className="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
                    <Panel className="h-fit overflow-hidden">
                        <PanelHeader
                            title="History"
                            eyebrow={`${list.length} migration${list.length === 1 ? '' : 's'}`}
                        />
                        <ol className="rows">
                            {list.map((migration) => {
                                const status = STATUS[migration.status]
                                return (
                                    <li key={migration.id}>
                                        <button
                                            type="button"
                                            onClick={() => select(migration.id)}
                                            aria-current={
                                                migration.id === selectedId ? 'true' : undefined
                                            }
                                            className={cn(
                                                'relative w-full px-4 py-3 text-left hover:bg-raised/60',
                                                migration.id === selectedId &&
                                                    'bg-raised before:absolute before:inset-y-0 before:left-0 before:w-[2px] before:bg-accent',
                                            )}
                                        >
                                            <span className="flex items-center gap-2">
                                                <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">
                                                    {migration.name}
                                                </span>
                                                <Badge
                                                    tone={status.tone}
                                                    dot
                                                    pulse={migration.status === 'applying'}
                                                >
                                                    {status.label}
                                                </Badge>
                                            </span>
                                            <span className="mt-1 flex items-center gap-2 font-mono text-[11px] text-ink-3">
                                                {migration.steps.length} step
                                                {migration.steps.length === 1 ? '' : 's'}
                                                {migration.destructive ? (
                                                    <span className="text-danger">
                                                        · destructive
                                                    </span>
                                                ) : null}
                                                <span className="ml-auto">
                                                    {formatRelative(
                                                        migration.appliedAt ?? migration.createdAt,
                                                    )}
                                                </span>
                                            </span>
                                        </button>
                                    </li>
                                )
                            })}
                        </ol>
                    </Panel>
                    {selected ? <MigrationDetail key={selected.id} migration={selected} /> : null}
                </div>
            )}

            <ReviewDialog
                open={reviewing}
                onClose={() => setReviewing(false)}
                onCreated={(id) => {
                    setReviewing(false)
                    void migrations.refetch()
                    void draft.refetch()
                    select(id)
                }}
            />
        </main>
    )
}

function MigrationDetail({ migration }: { migration: Migration }) {
    const projectId = useProjectId()
    const toast = useToast()
    const queryClient = useQueryClient()
    const [confirming, setConfirming] = useState(false)
    const [removing, setRemoving] = useState(false)
    const status = STATUS[migration.status]
    const canApply = migration.status === 'draft' || migration.status === 'failed'

    const invalidate = async () => {
        await Promise.all(
            ['migrations', 'draft', 'schema', 'project', 'projects'].map((key) =>
                queryClient.invalidateQueries({
                    queryKey: key === 'projects' ? [key] : [key, projectId],
                }),
            ),
        )
    }

    const apply = useMutation({
        mutationFn: () =>
            api<{ status: 'applied' | 'failed'; error?: string; durationMs?: number }>(
                projectApi(projectId, `/migrations/${migration.id}/apply`),
                {
                    body: { confirmDestructive: migration.destructive },
                },
            ),
        onSuccess: async (result) => {
            setConfirming(false)
            await invalidate()
            if (result.status === 'applied')
                toast(`Migration applied in ${formatDuration(result.durationMs)}`, 'success')
            else toast('The migration failed and was rolled back', 'error')
        },
        onError: async (error) => {
            setConfirming(false)
            await invalidate()
            toast(
                error instanceof ApiError ? error.message : 'Could not apply the migration',
                'error',
            )
        },
    })

    const remove = useMutation({
        mutationFn: () =>
            api(projectApi(projectId, `/migrations/${migration.id}`), { method: 'DELETE' }),
        onSuccess: async () => {
            setRemoving(false)
            await invalidate()
            toast('Migration deleted', 'success')
        },
        onError: (error) =>
            toast(
                error instanceof ApiError ? error.message : 'Could not delete the migration',
                'error',
            ),
    })

    return (
        <Panel className="min-w-0">
            <PanelHeader
                eyebrow="Migration"
                title={
                    <span className="flex flex-wrap items-center gap-2">
                        {migration.name}
                        <Badge tone={status.tone} dot pulse={migration.status === 'applying'}>
                            {status.label}
                        </Badge>
                    </span>
                }
                description={`Created ${formatDateTime(migration.createdAt)}${migration.createdBy ? ` by ${migration.createdBy}` : ''}${migration.appliedAt ? ` · applied ${formatDateTime(migration.appliedAt)}` : ''}${migration.durationMs !== null ? ` · ${formatDuration(migration.durationMs)}` : ''}`}
                actions={
                    canApply ? (
                        <>
                            <Button size="sm" variant="ghost" onClick={() => setRemoving(true)}>
                                <Trash2 size={13} /> Delete
                            </Button>
                            <Button
                                size="sm"
                                variant="primary"
                                onClick={() => setConfirming(true)}
                                busy={apply.isPending}
                            >
                                <Play size={12} className="fill-current" />{' '}
                                {migration.status === 'failed' ? 'Retry' : 'Apply'}
                            </Button>
                        </>
                    ) : null
                }
            />
            <div className="space-y-4 p-4">
                {migration.status === 'failed' && migration.errorMessage ? (
                    <Alert
                        title={
                            migration.errorStep !== null
                                ? `Step ${migration.errorStep + 1} failed; the transaction was rolled back`
                                : 'The migration failed'
                        }
                    >
                        <span className="font-mono text-[12px]">{migration.errorMessage}</span>
                    </Alert>
                ) : null}
                {migration.status === 'applied' && migration.errorMessage ? (
                    <Alert tone="info">{migration.errorMessage}</Alert>
                ) : null}
                {migration.status === 'applying' ? (
                    <Alert tone="warning" title="Waiting for PostgreSQL">
                        This migration was interrupted while running. DataForge checks the recorded
                        transaction id with pg_xact_status() and settles it as applied or failed
                        once the database knows.
                    </Alert>
                ) : null}
                {migration.destructive && canApply ? (
                    <Alert tone="warning" title="Destructive">
                        Some steps delete tables, columns or data. Applying asks you to confirm by
                        typing the migration&apos;s name.
                    </Alert>
                ) : null}

                <ol className="rows rounded-md border border-rule">
                    {migration.steps.map((step, index) => {
                        const failedHere =
                            migration.status === 'failed' && migration.errorStep === index
                        return (
                            <li
                                key={index}
                                className={cn(
                                    'flex items-start gap-3 px-3 py-2.5 text-[13px]',
                                    failedHere && 'bg-danger-soft',
                                )}
                            >
                                <span className="mt-0.5 w-5 shrink-0 font-mono text-[11px] text-ink-3">
                                    {index + 1}
                                </span>
                                <span className="min-w-0 flex-1">
                                    <span className="block">{step.summary}</span>
                                    {step.warning ? (
                                        <span className="mt-0.5 flex items-start gap-1.5 text-[12px] text-ink-3">
                                            <AlertTriangle
                                                size={12}
                                                className="mt-0.5 shrink-0 text-warn"
                                            />
                                            {step.warning}
                                        </span>
                                    ) : null}
                                </span>
                                {step.destructive ? <Badge tone="danger">Destructive</Badge> : null}
                                {failedHere ? <Badge tone="danger">Failed here</Badge> : null}
                            </li>
                        )
                    })}
                </ol>

                <div>
                    <div className="mb-2 flex items-center justify-between">
                        <h3 className="eyebrow">SQL</h3>
                        <Link
                            href={`/projects/${projectId}/sql`}
                            className="text-[12px] text-ink-3 hover:text-ink"
                        >
                            Open SQL editor
                        </Link>
                    </div>
                    <SqlBlock sql={migration.sql} className="max-h-[28rem]" />
                    <p className="mt-2 text-[12px] text-ink-3">
                        Runs as one transaction with a 5 s lock timeout. PostgreSQL DDL is
                        transactional, so if any step fails nothing is changed.
                    </p>
                </div>
            </div>

            <ConfirmDialog
                open={confirming}
                onClose={() => setConfirming(false)}
                onConfirm={() => apply.mutate()}
                busy={apply.isPending}
                title={migration.destructive ? 'Apply a destructive migration' : 'Apply migration'}
                confirmLabel="Apply migration"
                confirmText={migration.destructive ? migration.name : undefined}
                tone={migration.destructive ? 'danger' : 'primary'}
            >
                <p>
                    {migration.steps.length} statement{migration.steps.length === 1 ? '' : 's'} will
                    run against the database in one transaction.
                </p>
                {migration.destructive ? (
                    <p className="text-danger-text">
                        Destructive steps remove data permanently. DataForge cannot roll them back
                        after the transaction commits.
                    </p>
                ) : null}
            </ConfirmDialog>
            <ConfirmDialog
                open={removing}
                onClose={() => setRemoving(false)}
                onConfirm={() => remove.mutate()}
                busy={remove.isPending}
                title="Delete migration"
                confirmLabel="Delete"
            >
                <p>
                    The migration record is removed. The database and the designer draft are not
                    changed.
                </p>
            </ConfirmDialog>
        </Panel>
    )
}
