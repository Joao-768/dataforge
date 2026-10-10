'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Database, Layers, Plug } from 'lucide-react'
import { Alert } from '@/components/ui/feedback'
import { Button } from '@/components/ui/button'
import { ConfirmDialog, Dialog } from '@/components/ui/dialog'
import { Field, TextareaField } from '@/components/ui/field'
import { useToast } from '@/components/ui/toast'
import { api, ApiError, projectApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { projectSchema } from '@/shared/validation'

type Setup = 'ecommerce' | 'empty' | 'later'

const SETUPS: { value: Setup; title: string; description: string; icon: typeof Database }[] = [
    {
        value: 'ecommerce',
        title: 'Sandbox with sample data',
        description: 'A private PostgreSQL database with an e-commerce schema and realistic rows.',
        icon: Layers,
    },
    {
        value: 'empty',
        title: 'Empty sandbox',
        description: 'A private, empty PostgreSQL database to design from scratch.',
        icon: Database,
    },
    {
        value: 'later',
        title: 'Decide later',
        description: 'Create the project now and add a database from its settings.',
        icon: Plug,
    },
]

export function CreateProjectDialog({
    open,
    onClose,
    initialSetup = 'ecommerce',
}: {
    open: boolean
    onClose: () => void
    initialSetup?: Setup
}) {
    const router = useRouter()
    const toast = useToast()
    const queryClient = useQueryClient()
    const [setup, setSetup] = useState<Setup>(initialSetup)
    const [errors, setErrors] = useState<Record<string, string>>({})
    const [formError, setFormError] = useState<string | null>(null)
    const [busy, setBusy] = useState<string | null>(null)

    async function onSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const parsed = projectSchema.safeParse(
            Object.fromEntries(new FormData(event.currentTarget)),
        )
        if (!parsed.success) {
            setErrors(
                Object.fromEntries(
                    parsed.error.issues.map((issue) => [issue.path.join('.'), issue.message]),
                ),
            )
            return
        }
        setErrors({})
        setFormError(null)
        setBusy('Creating project…')
        let projectId: string | null = null
        try {
            projectId = (await api<{ id: string }>('/api/projects', { body: parsed.data })).id
            if (setup !== 'later') {
                setBusy('Provisioning the database…')
                await api(projectApi(projectId, '/connection/managed'), {
                    body: { template: setup },
                })
            }
            await queryClient.invalidateQueries({ queryKey: ['projects'] })
            toast(setup === 'later' ? 'Project created' : 'Project and database ready', 'success')
            router.push(`/projects/${projectId}${setup === 'later' ? '/settings' : ''}`)
        } catch (error) {
            const message = error instanceof ApiError ? error.message : 'Something went wrong.'
            if (projectId) {
                // The project exists; send the user there to retry the database step.
                toast(`Project created, but the database was not: ${message}`, 'error')
                await queryClient.invalidateQueries({ queryKey: ['projects'] })
                router.push(`/projects/${projectId}/settings`)
            } else {
                setFormError(message)
                setBusy(null)
            }
        }
    }

    return (
        <Dialog
            open={open}
            onClose={busy ? () => undefined : onClose}
            title="New project"
            size="md"
        >
            <form onSubmit={onSubmit} noValidate className="space-y-4">
                {formError ? <Alert>{formError}</Alert> : null}
                <Field
                    label="Name"
                    name="name"
                    autoFocus
                    maxLength={80}
                    error={errors.name}
                    placeholder="Inventory service"
                />
                <TextareaField
                    label="Description"
                    name="description"
                    rows={2}
                    maxLength={500}
                    error={errors.description}
                    hint="Optional."
                />
                <fieldset>
                    <legend className="mb-2 text-[13px] font-medium text-ink-2">Database</legend>
                    <div className="grid gap-2">
                        {SETUPS.map((option) => (
                            <label
                                key={option.value}
                                className={cn(
                                    'flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 transition-colors',
                                    setup === option.value
                                        ? 'border-accent bg-accent-soft/40'
                                        : 'border-rule hover:border-rule-strong',
                                )}
                            >
                                <input
                                    type="radio"
                                    name="setup"
                                    value={option.value}
                                    checked={setup === option.value}
                                    onChange={() => setSetup(option.value)}
                                    className="sr-only"
                                />
                                <option.icon
                                    size={16}
                                    className={cn(
                                        'mt-0.5 shrink-0',
                                        setup === option.value ? 'text-accent' : 'text-ink-3',
                                    )}
                                    aria-hidden="true"
                                />
                                <span>
                                    <span className="block text-[13.5px] font-medium">
                                        {option.title}
                                    </span>
                                    <span className="block text-[12.5px] text-ink-3">
                                        {option.description}
                                    </span>
                                </span>
                            </label>
                        ))}
                    </div>
                </fieldset>
                <div className="flex items-center justify-end gap-2 pt-1">
                    <Button variant="ghost" onClick={onClose} disabled={Boolean(busy)}>
                        Cancel
                    </Button>
                    <Button type="submit" variant="primary" busy={Boolean(busy)}>
                        {busy ?? 'Create project'}
                    </Button>
                </div>
            </form>
        </Dialog>
    )
}

export function RenameProjectDialog({
    project,
    onClose,
}: {
    project: { id: string; name: string; description: string } | null
    onClose: () => void
}) {
    const toast = useToast()
    const queryClient = useQueryClient()
    const [errors, setErrors] = useState<Record<string, string>>({})
    const [busy, setBusy] = useState(false)

    async function onSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (!project) return
        const parsed = projectSchema.safeParse(
            Object.fromEntries(new FormData(event.currentTarget)),
        )
        if (!parsed.success) {
            setErrors(
                Object.fromEntries(
                    parsed.error.issues.map((issue) => [issue.path.join('.'), issue.message]),
                ),
            )
            return
        }
        setBusy(true)
        try {
            await api(projectApi(project.id), { method: 'PATCH', body: parsed.data })
            await queryClient.invalidateQueries({ queryKey: ['projects'] })
            await queryClient.invalidateQueries({ queryKey: ['project', project.id] })
            toast('Project updated', 'success')
            onClose()
        } catch (error) {
            setErrors({ name: error instanceof ApiError ? error.message : 'Could not save.' })
        } finally {
            setBusy(false)
        }
    }

    return (
        <Dialog open={project !== null} onClose={onClose} title="Edit project" size="sm">
            {project ? (
                <form onSubmit={onSubmit} noValidate className="space-y-4">
                    <Field
                        label="Name"
                        name="name"
                        defaultValue={project.name}
                        autoFocus
                        maxLength={80}
                        error={errors.name}
                    />
                    <TextareaField
                        label="Description"
                        name="description"
                        defaultValue={project.description}
                        rows={3}
                        maxLength={500}
                        error={errors.description}
                    />
                    <div className="flex justify-end gap-2">
                        <Button variant="ghost" onClick={onClose}>
                            Cancel
                        </Button>
                        <Button type="submit" variant="primary" busy={busy}>
                            Save
                        </Button>
                    </div>
                </form>
            ) : null}
        </Dialog>
    )
}

export function DeleteProjectDialog({
    project,
    onClose,
    onDeleted,
}: {
    project: { id: string; name: string; database: { kind: string } | null } | null
    onClose: () => void
    onDeleted?: () => void
}) {
    const toast = useToast()
    const queryClient = useQueryClient()
    const [busy, setBusy] = useState(false)

    async function confirm() {
        if (!project) return
        setBusy(true)
        try {
            await api(projectApi(project.id), {
                method: 'DELETE',
                body: { confirmName: project.name },
            })
            await queryClient.invalidateQueries({ queryKey: ['projects'] })
            toast(`Deleted ${project.name}`, 'success')
            onClose()
            onDeleted?.()
        } catch (error) {
            toast(
                error instanceof ApiError ? error.message : 'Could not delete the project.',
                'error',
            )
        } finally {
            setBusy(false)
        }
    }

    return (
        <ConfirmDialog
            open={project !== null}
            onClose={onClose}
            onConfirm={confirm}
            busy={busy}
            title="Delete project"
            confirmLabel="Delete project"
            confirmText={project?.name}
        >
            <p>
                This deletes <strong className="text-ink">{project?.name}</strong>, its schema
                draft, migrations, saved queries and history.
            </p>
            {project?.database?.kind === 'managed' ? (
                <Alert tone="warning">
                    Its sandbox database and every row in it are dropped as well. This cannot be
                    undone.
                </Alert>
            ) : project?.database ? (
                <p>
                    The external database itself is not touched; only DataForge&apos;s connection to
                    it is removed.
                </p>
            ) : null}
        </ConfirmDialog>
    )
}
