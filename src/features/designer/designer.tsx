'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ReactFlowProvider, useReactFlow } from '@xyflow/react'
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels'
import {
    AlertTriangle,
    Check,
    CloudOff,
    GitBranch,
    LayoutGrid,
    Loader2,
    Maximize,
    Plus,
    Redo2,
    RotateCcw,
    Undo2,
    X,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button, IconButton } from '@/components/ui/button'
import { ConfirmDialog, Dialog } from '@/components/ui/dialog'
import { Alert, LoadingRows } from '@/components/ui/feedback'
import { Field } from '@/components/ui/field'
import { useToast } from '@/components/ui/toast'
import { SqlBlock } from '@/components/sql-block'
import { api, ApiError, projectApi } from '@/lib/api'
import { useMediaQuery } from '@/lib/use-media-query'
import { cn } from '@/lib/utils'
import type { DraftState, MigrationPlan } from '@/server/migrations/service'
import { diffSchemas } from '@/shared/schema/diff'
import type { DraftDocument } from '@/shared/schema/model'
import { validateTables } from '@/shared/schema/validate'
import { useProjectId } from '@/features/workspace/context'
import { DesignerCanvas } from '@/features/designer/canvas'
import { Inspector } from '@/features/designer/inspector'
import { autoLayout, nextFreePosition, NODE_WIDTH } from '@/features/designer/layout'
import { addTable, setPositions } from '@/features/designer/operations'
import { useDesigner, type SaveState } from '@/features/designer/store'

const AUTOSAVE_DELAY_MS = 700

export function Designer() {
    const projectId = useProjectId()
    const { data, error, isLoading, refetch } = useQuery({
        queryKey: ['draft', projectId],
        queryFn: () => api<DraftState>(projectApi(projectId, '/draft')),
        refetchOnWindowFocus: false,
        staleTime: Infinity,
    })
    const load = useDesigner((state) => state.load)
    const loadedRevision = useRef<string | null>(null)

    // Load the server draft into the store once per fetched revision, laying
    // out any table that has no saved position yet.
    useEffect(() => {
        if (!data) return
        const key = `${projectId}:${data.revision}:${data.updatedAt}`
        if (loadedRevision.current === key) return
        if (
            loadedRevision.current?.startsWith(`${projectId}:`) &&
            useDesigner.getState().saveState !== 'saved'
        )
            return
        loadedRevision.current = key
        let document: DraftDocument = data.document
        const missing = document.tables.filter((table) => !document.positions[table.id])
        if (missing.length > 0) {
            // One new table goes next to the others; anything more (a first
            // load, tables created from SQL) gets a fresh arrangement.
            const everything = missing.length > 1 || missing.length === document.tables.length
            const positions = everything ? autoLayout(document.tables) : {}
            if (!everything) {
                let next = nextFreePosition(document.positions)
                for (const table of missing) {
                    positions[table.id] = next
                    next = { x: next.x, y: next.y + 260 }
                }
            }
            document = setPositions(document, positions)
        }
        load(document, data.base, data.revision)
        if (missing.length > 0) useDesigner.setState({ saveState: 'pending', version: 1 })
    }, [data, load, projectId])

    if (isLoading) return <LoadingRows rows={8} />
    if (error || !data) {
        return (
            <div className="p-6">
                <Alert
                    action={
                        <Button size="sm" onClick={() => refetch()}>
                            Retry
                        </Button>
                    }
                >
                    {error instanceof ApiError ? error.message : 'Could not load the schema.'}
                </Alert>
            </div>
        )
    }
    return (
        <ReactFlowProvider>
            <DesignerWorkspace draft={data} />
        </ReactFlowProvider>
    )
}

function useAutosave(projectId: string) {
    const toast = useToast()
    const version = useDesigner((state) => state.version)
    const saving = useRef(false)

    const save = useCallback(async () => {
        const state = useDesigner.getState()
        if (!state.document || saving.current || state.saveState === 'conflict') return
        saving.current = true
        const sentVersion = state.version
        state.setSaveState('saving')
        try {
            const result = await api<{ revision: number }>(projectApi(projectId, '/draft'), {
                method: 'PUT',
                body: { document: state.document, revision: state.revision },
            })
            const after = useDesigner.getState()
            after.setRevision(result.revision)
            after.setSaveState(after.version === sentVersion ? 'saved' : 'pending')
        } catch (error) {
            if (error instanceof ApiError && error.status === 409) {
                useDesigner.getState().setSaveState('conflict')
            } else {
                useDesigner.getState().setSaveState('error')
                toast(
                    error instanceof ApiError ? error.message : 'Could not save the draft',
                    'error',
                )
            }
        } finally {
            saving.current = false
        }
    }, [projectId, toast])

    useEffect(() => {
        if (version === 0) return
        const state = useDesigner.getState().saveState
        if (state !== 'pending') return
        const timer = window.setTimeout(save, AUTOSAVE_DELAY_MS)
        return () => window.clearTimeout(timer)
    }, [version, save])

    // Retry a pending save once the in-flight one returns.
    const saveState = useDesigner((state) => state.saveState)
    useEffect(() => {
        if (saveState !== 'pending') return
        const timer = window.setTimeout(save, AUTOSAVE_DELAY_MS)
        return () => window.clearTimeout(timer)
    }, [saveState, save])

    // Warn before leaving with unsaved edits.
    useEffect(() => {
        const onBeforeUnload = (event: BeforeUnloadEvent) => {
            const state = useDesigner.getState().saveState
            if (state === 'pending' || state === 'saving') event.preventDefault()
        }
        window.addEventListener('beforeunload', onBeforeUnload)
        return () => window.removeEventListener('beforeunload', onBeforeUnload)
    }, [])

    return save
}

function SaveIndicator({ state }: { state: SaveState }) {
    const config: Record<SaveState, { icon: React.ReactNode; text: string; className: string }> = {
        saved: { icon: <Check size={13} />, text: 'Draft saved', className: 'text-ink-3' },
        pending: {
            icon: <Loader2 size={13} className="opacity-50" />,
            text: 'Unsaved',
            className: 'text-ink-3',
        },
        saving: {
            icon: <Loader2 size={13} className="animate-spin" />,
            text: 'Saving…',
            className: 'text-ink-3',
        },
        error: { icon: <CloudOff size={13} />, text: 'Not saved', className: 'text-danger' },
        conflict: {
            icon: <AlertTriangle size={13} />,
            text: 'Changed elsewhere',
            className: 'text-warn',
        },
    }
    const { icon, text, className } = config[state]
    return (
        <span
            className={cn('flex items-center gap-1.5 font-mono text-[11px]', className)}
            role="status"
            aria-live="polite"
        >
            {icon}
            {text}
        </span>
    )
}

function DesignerWorkspace({ draft }: { draft: DraftState }) {
    const projectId = useProjectId()
    const router = useRouter()
    const toast = useToast()
    const queryClient = useQueryClient()
    const flow = useReactFlow()
    const document = useDesigner((state) => state.document)
    const base = useDesigner((state) => state.base)
    const saveState = useDesigner((state) => state.saveState)
    const canUndo = useDesigner((state) => state.past.length > 0)
    const canRedo = useDesigner((state) => state.future.length > 0)
    const apply = useDesigner((state) => state.apply)
    const select = useDesigner((state) => state.select)
    const selection = useDesigner((state) => state.selection)
    const save = useAutosave(projectId)
    const [reviewOpen, setReviewOpen] = useState(false)
    const [discardOpen, setDiscardOpen] = useState(false)
    const [discarding, setDiscarding] = useState(false)
    const [inspectorOpen, setInspectorOpen] = useState(false)
    const layout = useDefaultLayout({ id: 'dataforge:designer', panelIds: ['canvas', 'inspector'] })
    // One inspector at a time: a side panel on wide screens, an overlay otherwise.
    const wide = useMediaQuery('(min-width: 1024px)')

    const diff = useMemo(
        () => (document ? diffSchemas(base, document.tables) : null),
        [base, document],
    )
    const issues = useMemo(
        () => (document ? validateTables(document.tables, base) : []),
        [base, document],
    )
    const tableStatus = useMemo(() => {
        const status = new Map<string, 'new' | 'changed'>()
        if (!document || !diff) return status
        const baseIds = new Set(base.map((table) => table.id))
        for (const table of document.tables) {
            if (!baseIds.has(table.id)) status.set(table.id, 'new')
        }
        const changedNames = new Set(diff.steps.map((step) => step.table))
        for (const table of document.tables) {
            if (!status.has(table.id) && changedNames.has(`${table.schema}.${table.name}`))
                status.set(table.id, 'changed')
        }
        return status
    }, [base, diff, document])
    const errors = issues.filter((issue) => issue.severity === 'error').length
    const pending = diff?.steps.length ?? 0

    // On small screens the inspector slides in whenever something new is selected.
    const [lastSelection, setLastSelection] = useState(selection)
    if (lastSelection !== selection) {
        setLastSelection(selection)
        if (selection.kind !== 'none') setInspectorOpen(true)
    }

    const arrange = useCallback(() => {
        const current = useDesigner.getState().document
        if (!current) return
        apply((doc) => setPositions(doc, autoLayout(doc.tables)))
        window.setTimeout(() => void flow.fitView({ padding: 0.15, duration: 300 }), 30)
    }, [apply, flow])

    const addTableNow = () => {
        const current = useDesigner.getState().document
        if (!current) return
        const center = flow.screenToFlowPosition({
            x: window.innerWidth / 2,
            y: window.innerHeight / 2,
        })
        const result = addTable(current, {
            x: Math.round(center.x - NODE_WIDTH / 2),
            y: Math.round(center.y - 60),
        })
        apply(() => result.document)
        select({ kind: 'table', tableId: result.tableId })
    }

    async function discard() {
        setDiscarding(true)
        try {
            await api(projectApi(projectId, '/draft/discard'), { method: 'POST' })
            useDesigner.getState().setSaveState('saved')
            await queryClient.invalidateQueries({ queryKey: ['draft', projectId] })
            await queryClient.refetchQueries({ queryKey: ['draft', projectId] })
            toast('Draft reset to the database schema', 'success')
            setDiscardOpen(false)
        } catch (error) {
            toast(
                error instanceof ApiError ? error.message : 'Could not discard the draft',
                'error',
            )
        } finally {
            setDiscarding(false)
        }
    }

    async function openReview() {
        if (saveState === 'pending' || saveState === 'saving') await save()
        setReviewOpen(true)
    }

    if (!document) return <LoadingRows rows={8} />

    const toolbar = (
        <div className="flex h-11 shrink-0 items-center gap-1 border-b border-rule bg-paper px-2 sm:px-3">
            <Button size="sm" variant="secondary" onClick={addTableNow} title="Add table (T)">
                <Plus size={14} aria-hidden="true" /> Table
            </Button>
            <span className="mx-1 h-5 w-px bg-rule" aria-hidden="true" />
            <IconButton
                label="Undo (⌘Z)"
                onClick={() => useDesigner.getState().undo()}
                disabled={!canUndo}
            >
                <Undo2 size={15} />
            </IconButton>
            <IconButton
                label="Redo (⌘⇧Z)"
                onClick={() => useDesigner.getState().redo()}
                disabled={!canRedo}
            >
                <Redo2 size={15} />
            </IconButton>
            <IconButton label="Arrange automatically (L)" onClick={arrange}>
                <LayoutGrid size={15} />
            </IconButton>
            <IconButton
                label="Fit schema in view (F)"
                onClick={() => void flow.fitView({ padding: 0.15, duration: 250 })}
            >
                <Maximize size={15} />
            </IconButton>
            <span className="ml-2 hidden sm:inline-flex">
                <SaveIndicator state={saveState} />
            </span>
            <div className="ml-auto flex items-center gap-2">
                {pending > 0 ? (
                    <>
                        <Badge tone="accent" className="hidden md:inline-flex">
                            {pending} pending change{pending === 1 ? '' : 's'}
                        </Badge>
                        <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setDiscardOpen(true)}
                            className="hidden sm:inline-flex"
                        >
                            <RotateCcw size={13} aria-hidden="true" /> Discard
                        </Button>
                    </>
                ) : (
                    <span className="hidden font-mono text-[11px] text-ink-3 md:inline">
                        In sync with the database
                    </span>
                )}
                <Button
                    size="sm"
                    variant="primary"
                    disabled={pending === 0 || saveState === 'conflict'}
                    onClick={openReview}
                    title={
                        errors > 0
                            ? `${errors} error${errors === 1 ? '' : 's'} to fix first`
                            : undefined
                    }
                >
                    <GitBranch size={14} aria-hidden="true" /> Review migration
                </Button>
                <Button
                    size="sm"
                    variant="ghost"
                    className="lg:hidden"
                    onClick={() => setInspectorOpen((open) => !open)}
                >
                    Inspector
                </Button>
            </div>
        </div>
    )

    return (
        <div className="flex h-[calc(100svh-var(--masthead-height)-var(--tabs-height)-44px)] min-h-[480px] flex-col">
            {toolbar}
            {draft.stale || saveState === 'conflict' ? (
                <div className="border-b border-rule bg-warn-soft px-4 py-2">
                    <p className="flex flex-wrap items-center gap-2 text-[12.5px]">
                        <AlertTriangle size={14} className="text-warn" aria-hidden="true" />
                        {saveState === 'conflict'
                            ? 'This draft was changed in another tab or window.'
                            : 'The database schema changed outside the designer (for example from the SQL editor). This draft is based on an older version.'}
                        <Button
                            size="xs"
                            variant="secondary"
                            onClick={() =>
                                saveState === 'conflict'
                                    ? (useDesigner.getState().setSaveState('saved'),
                                      void queryClient.refetchQueries({
                                          queryKey: ['draft', projectId],
                                      }))
                                    : setDiscardOpen(true)
                            }
                        >
                            {saveState === 'conflict'
                                ? 'Reload the latest draft'
                                : 'Reset draft to the database'}
                        </Button>
                    </p>
                </div>
            ) : null}
            <div className="relative min-h-0 flex-1">
                <Group
                    orientation="horizontal"
                    className="h-full"
                    defaultLayout={layout.defaultLayout}
                    onLayoutChanged={layout.onLayoutChanged}
                >
                    <Panel id="canvas" minSize="40" className="blueprint">
                        <DesignerCanvas
                            tableStatus={tableStatus}
                            issues={issues}
                            onArrange={arrange}
                        />
                    </Panel>
                    <Separator className="hidden lg:block" />
                    <Panel
                        id="inspector"
                        defaultSize="26"
                        minSize="18"
                        maxSize="45"
                        className="hidden bg-panel lg:block"
                    >
                        {wide ? (
                            <aside
                                aria-label="Inspector"
                                className="scrollbar-thin h-full overflow-y-auto"
                            >
                                <Inspector issues={issues} />
                            </aside>
                        ) : null}
                    </Panel>
                </Group>
                {inspectorOpen && !wide ? (
                    <aside
                        aria-label="Inspector"
                        className="scrollbar-thin absolute inset-y-0 right-0 z-20 w-[min(100%,22rem)] animate-fade-in overflow-y-auto border-l border-rule bg-panel shadow-2xl lg:hidden"
                    >
                        <div className="flex justify-end border-b border-rule p-1">
                            <IconButton
                                label="Close inspector"
                                onClick={() => setInspectorOpen(false)}
                            >
                                <X size={15} />
                            </IconButton>
                        </div>
                        <Inspector issues={issues} />
                    </aside>
                ) : null}
            </div>

            <ReviewDialog
                open={reviewOpen}
                onClose={() => setReviewOpen(false)}
                onCreated={(id) => router.push(`/projects/${projectId}/migrations?migration=${id}`)}
            />
            <ConfirmDialog
                open={discardOpen}
                onClose={() => setDiscardOpen(false)}
                onConfirm={discard}
                busy={discarding}
                title="Discard draft changes"
                confirmLabel="Discard changes"
            >
                <p>
                    The draft goes back to the current database schema. Table positions on the
                    canvas are kept.
                </p>
                {pending > 0 ? (
                    <p>
                        {pending} pending change{pending === 1 ? '' : 's'} will be lost.
                    </p>
                ) : null}
            </ConfirmDialog>
        </div>
    )
}

export function ReviewDialog({
    open,
    onClose,
    onCreated,
}: {
    open: boolean
    onClose: () => void
    onCreated: (id: string) => void
}) {
    const projectId = useProjectId()
    const queryClient = useQueryClient()
    const toast = useToast()
    const [nameOverride, setNameOverride] = useState<string | null>(null)
    const [wasOpen, setWasOpen] = useState(open)
    const [creating, setCreating] = useState(false)
    const preview = useQuery({
        queryKey: ['migration-preview', projectId],
        queryFn: () =>
            api<MigrationPlan>(projectApi(projectId, '/migrations/preview'), { method: 'POST' }),
        enabled: open,
        gcTime: 0,
        staleTime: 0,
    })
    const plan = preview.data
    const errors = plan?.issues.filter((issue) => issue.severity === 'error') ?? []

    if (open !== wasOpen) {
        setWasOpen(open)
        setNameOverride(null)
    }
    // Suggested from the plan until the user types their own.
    const added = plan?.summary.tablesAdded.map((table) => table.split('.')[1]) ?? []
    const name = nameOverride ?? (added.length ? `Add ${added.join(', ')}` : 'Update schema')
    const setName = setNameOverride

    async function create() {
        setCreating(true)
        try {
            const { id } = await api<{ id: string }>(projectApi(projectId, '/migrations'), {
                body: { name },
            })
            await queryClient.invalidateQueries({ queryKey: ['migrations', projectId] })
            toast('Migration created. Review and apply it.', 'success')
            onCreated(id)
        } catch (error) {
            toast(
                error instanceof ApiError ? error.message : 'Could not create the migration',
                'error',
            )
            setCreating(false)
        }
    }

    return (
        <Dialog
            open={open}
            onClose={onClose}
            size="lg"
            title="Review migration"
            description="The SQL below is generated from your draft. Nothing runs until you apply it."
            footer={
                <>
                    <Button variant="ghost" onClick={onClose}>
                        Keep editing
                    </Button>
                    <Button
                        variant="primary"
                        onClick={create}
                        busy={creating}
                        disabled={
                            !plan || errors.length > 0 || plan.steps.length === 0 || !name.trim()
                        }
                    >
                        Create migration
                    </Button>
                </>
            }
        >
            {preview.isLoading ? (
                <LoadingRows rows={4} />
            ) : preview.error ? (
                <Alert>{(preview.error as Error).message}</Alert>
            ) : plan ? (
                <div className="space-y-4">
                    {errors.length > 0 ? (
                        <Alert
                            title={`Fix ${errors.length} error${errors.length === 1 ? '' : 's'} first`}
                        >
                            <ul className="mt-1 list-disc pl-4">
                                {errors.slice(0, 6).map((issue, index) => (
                                    <li key={index}>{issue.message}</li>
                                ))}
                            </ul>
                        </Alert>
                    ) : null}
                    {plan.destructive ? (
                        <Alert tone="warning" title="This migration deletes data">
                            Steps marked destructive cannot be undone by DataForge. You will be
                            asked to confirm before applying.
                        </Alert>
                    ) : null}
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        {[
                            ['Tables added', plan.summary.tablesAdded.length],
                            ['Tables removed', plan.summary.tablesRemoved.length],
                            [
                                'Columns changed',
                                plan.summary.columnsAdded +
                                    plan.summary.columnsRemoved +
                                    plan.summary.columnsChanged,
                            ],
                            ['Constraints', plan.summary.constraintsChanged],
                        ].map(([label, value]) => (
                            <div key={label} className="rounded-md border border-rule px-3 py-2">
                                <p className="eyebrow">{label}</p>
                                <p className="mt-0.5 text-[17px] font-semibold tabular-nums">
                                    {value}
                                </p>
                            </div>
                        ))}
                    </div>
                    <ol className="rows rounded-md border border-rule">
                        {plan.steps.map((step, index) => (
                            <li
                                key={index}
                                className="flex items-start gap-3 px-3 py-2 text-[13px]"
                            >
                                <span className="mt-0.5 w-5 shrink-0 font-mono text-[11px] text-ink-3">
                                    {index + 1}
                                </span>
                                <span className="min-w-0 flex-1">
                                    <span className="block">{step.summary}</span>
                                    {step.warning ? (
                                        <span className="block text-[12px] text-ink-3">
                                            {step.warning}
                                        </span>
                                    ) : null}
                                </span>
                                {step.destructive ? <Badge tone="danger">Destructive</Badge> : null}
                            </li>
                        ))}
                    </ol>
                    <SqlBlock sql={plan.sql} className="max-h-72" />
                    <Field
                        label="Migration name"
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        maxLength={120}
                    />
                </div>
            ) : null}
        </Dialog>
    )
}
