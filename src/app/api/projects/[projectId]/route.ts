import { z } from 'zod'
import { AppError } from '@/server/errors'
import { authedRoute } from '@/server/http/route'
import {
    deleteProject,
    getProjectSummary,
    recentActivity,
    requireProject,
    updateProject,
} from '@/server/projects/service'
import { getConnection } from '@/server/targets/connections'
import { projectUpdateSchema } from '@/shared/validation'

export const GET = authedRoute(async (ctx) => {
    const { projectId } = ctx.params
    return {
        project: await getProjectSummary(ctx.user.id, projectId!),
        connection: await getConnection(ctx.user.id, projectId!),
        activity: await recentActivity(ctx.user.id, projectId, 15),
    }
})

export const PATCH = authedRoute(async (ctx) => {
    await updateProject(ctx.user.id, ctx.params.projectId!, await ctx.body(projectUpdateSchema))
    return getProjectSummary(ctx.user.id, ctx.params.projectId!)
})

// Deleting needs the project's name typed back, checked here as well as in
// the confirmation dialog.
export const DELETE = authedRoute(async (ctx) => {
    const project = await requireProject(ctx.user.id, ctx.params.projectId!)
    const { confirmName } = await ctx.body(z.object({ confirmName: z.string() }))
    if (confirmName.trim() !== project.name) {
        throw new AppError('validation_failed', 'Type the project name exactly to confirm.')
    }
    await deleteProject(ctx.user.id, project.id)
    return { ok: true }
})
