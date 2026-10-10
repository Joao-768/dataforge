import { authedRoute } from '@/server/http/route'
import { createSaved, listSaved, savedQuerySchema } from '@/server/queries/saved'

export const GET = authedRoute(async (ctx) => ({
    saved: await listSaved(ctx.user.id, ctx.params.projectId!),
}))

export const POST = authedRoute(async (ctx) =>
    createSaved(ctx.user.id, ctx.params.projectId!, await ctx.body(savedQuerySchema)),
)
