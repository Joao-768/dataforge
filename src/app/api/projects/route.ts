import { authedRoute } from '@/server/http/route'
import { createProject, listProjects, recentActivity } from '@/server/projects/service'
import { projectSchema } from '@/shared/validation'

export const GET = authedRoute(async (ctx) => ({
    projects: await listProjects(ctx.user.id),
    activity: await recentActivity(ctx.user.id, undefined, 12),
}))

export const POST = authedRoute(async (ctx) =>
    createProject(ctx.user.id, await ctx.body(projectSchema)),
)
