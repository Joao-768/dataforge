import { authedRoute } from '@/server/http/route'
import { getDraft, saveDraft, saveDraftSchema } from '@/server/migrations/service'

export const GET = authedRoute(async (ctx) => getDraft(ctx.user.id, ctx.params.projectId!))

export const PUT = authedRoute(async (ctx) =>
    saveDraft(ctx.user.id, ctx.params.projectId!, await ctx.body(saveDraftSchema)),
)
