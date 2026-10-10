import { authedRoute } from '@/server/http/route'
import { executeScript, runSchema } from '@/server/query/executor'
import { invalidateSchema } from '@/server/schema/cache'
import { RULES } from '@/server/security/rate-limit'

export const POST = authedRoute(
    async (ctx) => {
        const input = await ctx.body(runSchema)
        const result = await executeScript(ctx.user.id, ctx.params.projectId!, input)
        // Write-mode scripts may have changed the structure.
        if (input.mode === 'write') {
            const { getConnection } = await import('@/server/targets/connections')
            const connection = await getConnection(ctx.user.id, ctx.params.projectId!)
            if (connection) invalidateSchema(connection.id)
        }
        return result
    },
    { rateLimit: RULES.query },
)
