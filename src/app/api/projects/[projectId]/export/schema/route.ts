import { authedRoute } from '@/server/http/route'
import { exportSchemaSql } from '@/server/transfer/export'

export const GET = authedRoute(async (ctx) => {
    const sql = await exportSchemaSql(ctx.user.id, ctx.params.projectId!)
    return new Response(sql, {
        headers: {
            'Content-Type': 'application/sql; charset=utf-8',
            'Content-Disposition': 'attachment; filename="schema.sql"',
            'Cache-Control': 'no-store',
        },
    })
})
