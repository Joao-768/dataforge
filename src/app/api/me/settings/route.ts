import { getSettings, updateSettings } from '@/server/auth/service'
import { authedRoute } from '@/server/http/route'
import { settingsSchema } from '@/shared/validation'

export const GET = authedRoute(async (ctx) => getSettings(ctx.user.id))

export const PUT = authedRoute(async (ctx) => {
    await updateSettings(ctx.user.id, await ctx.body(settingsSchema))
    return getSettings(ctx.user.id)
})
