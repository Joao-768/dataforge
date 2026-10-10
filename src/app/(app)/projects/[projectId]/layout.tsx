import { notFound, redirect } from 'next/navigation'
import { WorkspaceShell } from '@/features/workspace/shell'
import { AppError } from '@/server/errors'
import { currentUser } from '@/server/auth/session'
import { requireProject } from '@/server/projects/service'

// Ownership is checked on the server before anything renders: another
// user's project id gives a 404, the same as an id that does not exist.
export default async function ProjectLayout({
    children,
    params,
}: LayoutProps<'/projects/[projectId]'>) {
    const { projectId } = await params
    const user = await currentUser()
    if (!user) redirect('/login')
    try {
        await requireProject(user.id, projectId)
    } catch (error) {
        if (error instanceof AppError && error.code === 'not_found') notFound()
        throw error
    }
    return <WorkspaceShell projectId={projectId}>{children}</WorkspaceShell>
}
