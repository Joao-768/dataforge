'use client'

import type { ReactNode } from 'react'
import { Database } from 'lucide-react'
import { ButtonLink } from '@/components/ui/button'
import { Alert, EmptyState, LoadingRows } from '@/components/ui/feedback'
import { useProject, useProjectId } from '@/features/workspace/context'

/** Renders children only once the project has a reachable database. */
export function RequiresDatabase({ children }: { children: ReactNode }) {
    const projectId = useProjectId()
    const { data, isLoading, error } = useProject()
    if (isLoading) return <LoadingRows rows={6} />
    if (error)
        return (
            <div className="p-6">
                <Alert>Could not load this project.</Alert>
            </div>
        )
    if (!data?.connection) {
        return (
            <EmptyState
                className="blueprint flex-1"
                icon={<Database size={18} />}
                title="This project has no database yet"
                action={
                    <ButtonLink href={`/projects/${projectId}/settings`} variant="primary">
                        Set up a database
                    </ButtonLink>
                }
            >
                Create a sandbox (empty or with sample data) or connect an existing PostgreSQL
                database.
            </EmptyState>
        )
    }
    return <>{children}</>
}
