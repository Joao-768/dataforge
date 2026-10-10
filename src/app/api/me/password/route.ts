import { changePassword } from '@/server/auth/service'
import { authedRoute } from '@/server/http/route'
import { RULES } from '@/server/security/rate-limit'
import { changePasswordSchema } from '@/shared/validation'

export const POST = authedRoute(
    async (ctx) => {
        await changePassword(ctx.user, await ctx.body(changePasswordSchema))
        return { ok: true }
    },
    { rateLimit: RULES.login },
)
