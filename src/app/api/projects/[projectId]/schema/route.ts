import { authedRoute } from '@/server/http/route'
import { liveSchema } from '@/server/schema/cache'
import { fingerprint } from '@/server/schema/introspect'
import { projectTarget, rememberTableCount } from '@/server/targets/connections'

export const GET = authedRoute(async (ctx) => {
    const target = await projectTarget(ctx.user.id, ctx.params.projectId!, 'read')
    const schema = await liveSchema(target, { fresh: true })
    await rememberTableCount(ctx.params.projectId!, schema.tables.length)
    return { ...schema, fingerprint: fingerprint(schema.tables) }
})
