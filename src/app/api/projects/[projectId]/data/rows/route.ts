import {
    deleteRows,
    deleteSchema,
    insertRow,
    insertSchema,
    updateRow,
    updateSchema,
} from '@/server/data/explorer'
import { authedRoute } from '@/server/http/route'
import { RULES } from '@/server/security/rate-limit'

const options = { rateLimit: RULES.write }

export const POST = authedRoute(
    async (ctx) => insertRow(ctx.user.id, ctx.params.projectId!, await ctx.body(insertSchema)),
    options,
)

export const PATCH = authedRoute(
    async (ctx) => updateRow(ctx.user.id, ctx.params.projectId!, await ctx.body(updateSchema)),
    options,
)

export const DELETE = authedRoute(
    async (ctx) => deleteRows(ctx.user.id, ctx.params.projectId!, await ctx.body(deleteSchema)),
    options,
)
