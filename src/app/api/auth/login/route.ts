import { login } from '@/server/auth/service'
import { publicRoute } from '@/server/http/route'
import { RULES } from '@/server/security/rate-limit'
import { loginSchema } from '@/shared/validation'

export const POST = publicRoute(
    async (ctx) => {
        await login(await ctx.body(loginSchema))
        return { ok: true }
    },
    { rateLimit: RULES.login },
)
