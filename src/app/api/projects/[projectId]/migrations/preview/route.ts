import { authedRoute } from '@/server/http/route'
import { previewMigration } from '@/server/migrations/service'

export const POST = authedRoute(async (ctx) => previewMigration(ctx.user.id, ctx.params.projectId!))
