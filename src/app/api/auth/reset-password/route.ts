import { resetPassword } from '@/server/auth/service'
import { publicRoute } from '@/server/http/route'
import { RULES } from '@/server/security/rate-limit'
import { resetPasswordSchema } from '@/shared/validation'

export const POST = publicRoute(
    async (ctx) => {
        const { token, password } = await ctx.body(resetPasswordSchema)
        await resetPassword(token, password)
        return { ok: true }
    },
    { rateLimit: RULES.passwordReset },
)
