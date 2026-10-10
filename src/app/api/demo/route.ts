import { startDemo } from '@/server/demo/service'
import { publicRoute } from '@/server/http/route'
import { RULES } from '@/server/security/rate-limit'

export const POST = publicRoute(
    async (ctx) => startDemo(ctx.ip, ctx.request.headers.get('user-agent')),
    { rateLimit: RULES.demo },
)
