import { engineStats } from '@/server/analytics/service'
import { authedRoute } from '@/server/http/route'

export const GET = authedRoute(async (ctx) => engineStats(ctx.user.id, ctx.params.projectId!))
