import { authedRoute } from '@/server/http/route'
import { RULES } from '@/server/security/rate-limit'
import { checkConnection } from '@/server/targets/connections'

export const POST = authedRoute(
    async (ctx) => ({ connection: await checkConnection(ctx.user.id, ctx.params.projectId!) }),
    { rateLimit: RULES.connectionTest },
)
