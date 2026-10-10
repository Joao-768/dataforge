import { authedRoute } from '@/server/http/route'
import { applyMigration, applyMigrationSchema } from '@/server/migrations/service'
import { RULES } from '@/server/security/rate-limit'

export const POST = authedRoute(
    async (ctx) => {
        const { confirmDestructive } = await ctx.body(applyMigrationSchema)
        return applyMigration(
            ctx.user.id,
            ctx.params.projectId!,
            ctx.params.migrationId!,
            confirmDestructive,
        )
    },
    { rateLimit: RULES.write },
)
