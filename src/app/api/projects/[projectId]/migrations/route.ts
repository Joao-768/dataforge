import { authedRoute } from '@/server/http/route'
import { createMigration, createMigrationSchema, listMigrations } from '@/server/migrations/service'

export const GET = authedRoute(async (ctx) => ({
    migrations: await listMigrations(ctx.user.id, ctx.params.projectId!),
}))

export const POST = authedRoute(async (ctx) => {
    const { name } = await ctx.body(createMigrationSchema)
    return createMigration(ctx.user.id, ctx.params.projectId!, name)
})
