'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { LoadingRows } from '@/components/ui/feedback'
import { Field, TextareaField } from '@/components/ui/field'
import { Panel, PanelHeader } from '@/components/ui/panel'
import { useToast } from '@/components/ui/toast'
import { api, ApiError, projectApi } from '@/lib/api'
import { projectSchema } from '@/shared/validation'
import { ConnectionPanel } from '@/features/overview/connection-panel'
import { DeleteProjectDialog } from '@/features/projects/project-dialogs'
import { useProject, useProjectId } from '@/features/workspace/context'

export function ProjectSettings() {
    const projectId = useProjectId()
    const router = useRouter()
    const toast = useToast()
    const queryClient = useQueryClient()
    const { data } = useProject()
    const [errors, setErrors] = useState<Record<string, string>>({})
    const [busy, setBusy] = useState(false)
    const [deleting, setDeleting] = useState(false)

    async function save(event: FormEvent<HTMLFormElement>) {
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
        setBusy(true)
        try {
            await api(projectApi(projectId), { method: 'PATCH', body: parsed.data })
            await queryClient.invalidateQueries({ queryKey: ['project', projectId] })
            await queryClient.invalidateQueries({ queryKey: ['projects'] })
            toast('Project saved', 'success')
        } catch (error) {
            setErrors({ name: error instanceof ApiError ? error.message : 'Could not save.' })
        } finally {
            setBusy(false)
        }
    }

    if (!data) return <LoadingRows rows={6} />

    return (
        <main className="mx-auto w-full max-w-[880px] space-y-6 px-4 pt-6 pb-16 sm:px-6">
            <div>
                <p className="eyebrow mb-1.5">Project</p>
                <h1 className="text-[22px] font-semibold tracking-[-0.015em]">Settings</h1>
            </div>
            <Panel>
                <PanelHeader title="General" />
                <form onSubmit={save} noValidate className="space-y-4 p-4">
                    <Field
                        label="Name"
                        name="name"
                        defaultValue={data.project.name}
                        maxLength={80}
                        error={errors.name}
                    />
                    <TextareaField
                        label="Description"
                        name="description"
                        defaultValue={data.project.description}
                        rows={3}
                        maxLength={500}
                        error={errors.description}
                    />
                    <div className="flex justify-end">
                        <Button type="submit" variant="primary" busy={busy}>
                            Save
                        </Button>
                    </div>
                </form>
            </Panel>
            <ConnectionPanel />
            <Panel className="border-danger/40">
                <PanelHeader
                    title="Delete project"
                    eyebrow="Danger zone"
                    description="Removes the project, its history and, for sandboxes, the database itself."
                />
                <div className="p-4">
                    <Button variant="danger" onClick={() => setDeleting(true)}>
                        <Trash2 size={14} /> Delete this project
                    </Button>
                </div>
            </Panel>
            <DeleteProjectDialog
                project={
                    deleting
                        ? {
                              id: data.project.id,
                              name: data.project.name,
                              database: data.project.database,
                          }
                        : null
                }
                onClose={() => setDeleting(false)}
                onDeleted={() => router.push('/projects')}
            />
        </main>
    )
}
