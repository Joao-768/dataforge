import { z } from 'zod'
import { query } from '@/server/db/app-db'
import { EXAMPLE_QUERIES } from '@/server/demo/examples'
import { authedRoute } from '@/server/http/route'
import { RULES } from '@/server/security/rate-limit'
import { provisionManaged } from '@/server/targets/connections'

export const POST = authedRoute(
    async (ctx) => {
        const { template } = await ctx.body(z.object({ template: z.enum(['empty', 'ecommerce']) }))
        const projectId = ctx.params.projectId!
        const connection = await provisionManaged(ctx.user.id, projectId, template, {
            isGuest: ctx.user.isGuest,
        })
        if (template === 'ecommerce') {
            for (const example of EXAMPLE_QUERIES) {
                await query(
                    'INSERT INTO saved_queries (project_id, user_id, name, sql) VALUES ($1, $2, $3, $4)',
                    [projectId, ctx.user.id, example.name, example.sql],
                )
            }
        }
        return { connection }
    },
    { rateLimit: RULES.provision },
)
