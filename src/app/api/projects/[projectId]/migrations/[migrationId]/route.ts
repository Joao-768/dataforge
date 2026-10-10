import { authedRoute } from '@/server/http/route'
import { deleteMigration, getMigration, toMigration } from '@/server/migrations/service'

export const GET = authedRoute(async (ctx) =>
    toMigration(await getMigration(ctx.user.id, ctx.params.projectId!, ctx.params.migrationId!)),
)

export const DELETE = authedRoute(async (ctx) => {
    await deleteMigration(ctx.user.id, ctx.params.projectId!, ctx.params.migrationId!)
    return { ok: true }
})
