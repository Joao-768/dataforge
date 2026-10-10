import { authedRoute } from '@/server/http/route'
import { explainSchema, explainStatement } from '@/server/query/executor'
import { RULES } from '@/server/security/rate-limit'

export const POST = authedRoute(
    async (ctx) =>
        explainStatement(ctx.user.id, ctx.params.projectId!, await ctx.body(explainSchema)),
    { rateLimit: RULES.query },
)
