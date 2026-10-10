import { authedRoute } from '@/server/http/route'
import {
    externalConnectionsEnabled,
    getConnection,
    removeConnection,
} from '@/server/targets/connections'

export const GET = authedRoute(async (ctx) => ({
    connection: await getConnection(ctx.user.id, ctx.params.projectId!),
    externalConnections: externalConnectionsEnabled(),
}))

export const DELETE = authedRoute(async (ctx) => {
    await removeConnection(ctx.user.id, ctx.params.projectId!)
    return { ok: true }
})
