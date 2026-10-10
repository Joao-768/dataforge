'use client'

import { createContext, useContext, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, projectApi } from '@/lib/api'
import type { ProjectSummary } from '@/server/projects/service'
import type { ConnectionInfo } from '@/server/targets/connections'

export interface ProjectDetails {
    project: ProjectSummary
    connection: ConnectionInfo | null
    activity: { id: string; kind: string; message: string; createdAt: string }[]
}

const ProjectContext = createContext<string | null>(null)

export function ProjectProvider({
    projectId,
    children,
}: {
    projectId: string
    children: ReactNode
}) {
    return <ProjectContext.Provider value={projectId}>{children}</ProjectContext.Provider>
}

export function useProjectId(): string {
    const id = useContext(ProjectContext)
    if (!id) throw new Error('useProjectId must be used inside a project workspace')
    return id
}

export function useProject() {
    const projectId = useProjectId()
    return useQuery({
        queryKey: ['project', projectId],
        queryFn: () => api<ProjectDetails>(projectApi(projectId)),
    })
}
