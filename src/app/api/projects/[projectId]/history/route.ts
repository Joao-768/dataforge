import { z } from 'zod'
import { authedRoute } from '@/server/http/route'
import { requireProject } from '@/server/projects/service'
import { listHistory } from '@/server/query/history'

export const GET = authedRoute(async (ctx) => {
    await requireProject(ctx.user.id, ctx.params.projectId!)
    const { limit, before } = ctx.search(
        z.object({
            limit: z.coerce.number().int().min(1).max(200).default(50),
            before: z.coerce.number().int().optional(),
        }),
    )
    return { history: await listHistory(ctx.params.projectId!, ctx.user.id, limit, before) }
})
