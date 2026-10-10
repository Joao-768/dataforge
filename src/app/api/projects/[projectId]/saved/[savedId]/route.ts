import { authedRoute } from '@/server/http/route'
import { deleteSaved, savedQuerySchema, updateSaved } from '@/server/queries/saved'

export const PUT = authedRoute(async (ctx) =>
    updateSaved(
        ctx.user.id,
        ctx.params.projectId!,
        ctx.params.savedId!,
        await ctx.body(savedQuerySchema),
    ),
)

export const DELETE = authedRoute(async (ctx) => {
    await deleteSaved(ctx.user.id, ctx.params.projectId!, ctx.params.savedId!)
    return { ok: true }
})
