import { register } from '@/server/auth/service'
import { publicRoute } from '@/server/http/route'
import { RULES } from '@/server/security/rate-limit'
import { registerSchema } from '@/shared/validation'

export const POST = publicRoute(
    async (ctx) => {
        await register(await ctx.body(registerSchema))
        return { ok: true }
    },
    { rateLimit: RULES.register },
)
