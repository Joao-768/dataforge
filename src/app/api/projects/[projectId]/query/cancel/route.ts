import { z } from 'zod'
import { authedRoute } from '@/server/http/route'
import { requireProject } from '@/server/projects/service'
import { cancelRun } from '@/server/query/session'

export const POST = authedRoute(async (ctx) => {
    await requireProject(ctx.user.id, ctx.params.projectId!)
    const { runId } = await ctx.body(z.object({ runId: z.uuid() }))
    return { cancelled: await cancelRun(ctx.user.id, runId) }
})
