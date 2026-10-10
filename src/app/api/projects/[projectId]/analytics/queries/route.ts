import { z } from 'zod'
import { queryStats } from '@/server/analytics/service'
import { authedRoute } from '@/server/http/route'

export const GET = authedRoute(async (ctx) => {
    const { days } = ctx.search(
        z.object({ days: z.coerce.number().int().min(1).max(90).default(14) }),
    )
    return queryStats(ctx.user.id, ctx.params.projectId!, days)
})
