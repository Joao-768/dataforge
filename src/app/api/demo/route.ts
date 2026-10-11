import { startDemo } from '@/server/demo/service'
import { publicRoute } from '@/server/http/route'
import { config } from '@/server/config'
import { hit, RULES } from '@/server/security/rate-limit'

export const POST = publicRoute(async (ctx) => {
    hit({ ...RULES.demo, limit: config().DEMO_STARTS_PER_HOUR }, ctx.ip)
    return startDemo(ctx.ip, ctx.request.headers.get('user-agent'))
})
