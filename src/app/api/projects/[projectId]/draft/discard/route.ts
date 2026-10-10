import { authedRoute } from '@/server/http/route'
import { discardDraft, getDraft } from '@/server/migrations/service'

export const POST = authedRoute(async (ctx) => {
    await discardDraft(ctx.user.id, ctx.params.projectId!)
    return getDraft(ctx.user.id, ctx.params.projectId!)
})
