import { requestPasswordReset } from '@/server/auth/service'
import { publicRoute } from '@/server/http/route'
import { RULES } from '@/server/security/rate-limit'
import { forgotPasswordSchema } from '@/shared/validation'

// Always answers the same way, so it cannot be used to find out which email
// addresses have accounts.
export const POST = publicRoute(
    async (ctx) => {
        const { email } = await ctx.body(forgotPasswordSchema)
        await requestPasswordReset(email)
        return { ok: true }
    },
    { rateLimit: RULES.passwordReset },
)
