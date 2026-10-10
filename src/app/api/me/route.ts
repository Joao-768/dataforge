import { z } from 'zod'
import { deleteAccount, getSettings, toPublicUser, updateProfile } from '@/server/auth/service'
import { authedRoute } from '@/server/http/route'
import { deleteAccountSchema, profileSchema } from '@/shared/validation'

export const GET = authedRoute(async (ctx) => ({
    user: toPublicUser(ctx.user),
    settings: await getSettings(ctx.user.id),
}))

export const PATCH = authedRoute(async (ctx) => {
    await updateProfile(ctx.user, await ctx.body(profileSchema))
    return { ok: true }
})

export const DELETE = authedRoute(async (ctx) => {
    const input = await ctx.body(
        ctx.user.isGuest
            ? deleteAccountSchema.extend({ password: z.string().optional() })
            : deleteAccountSchema,
    )
    await deleteAccount(ctx.user, input.password)
    return { ok: true }
})
