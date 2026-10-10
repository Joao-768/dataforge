import { browse, browseSchema } from '@/server/data/explorer'
import { authedRoute } from '@/server/http/route'
import { RULES } from '@/server/security/rate-limit'

export const GET = authedRoute(
    async (ctx) => browse(ctx.user.id, ctx.params.projectId!, ctx.search(browseSchema)),
    { rateLimit: RULES.query },
)
