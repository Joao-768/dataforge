import { authedRoute } from '@/server/http/route'
import { RULES } from '@/server/security/rate-limit'
import { addExternal, externalConnectionSchema } from '@/server/targets/connections'

export const POST = authedRoute(
    async (ctx) => ({
        connection: await addExternal(
            ctx.user.id,
            ctx.params.projectId!,
            await ctx.body(externalConnectionSchema),
        ),
    }),
    { rateLimit: RULES.connectionTest },
)
