import { z } from 'zod'
import { authedRoute } from '@/server/http/route'
import { exportTableCsv, exportTableSql, exportTableSchema } from '@/server/transfer/export'

function filename(name: string, extension: string) {
    return `${name.replace(/[^A-Za-z0-9_.-]+/g, '_')}.${extension}`
}

export const GET = authedRoute(async (ctx) => {
    const input = ctx.search(
        exportTableSchema.extend({ format: z.enum(['csv', 'sql']).default('csv') }),
    )
    const stream =
        input.format === 'csv'
            ? await exportTableCsv(ctx.user.id, ctx.params.projectId!, input.schema, input.table)
            : await exportTableSql(ctx.user.id, ctx.params.projectId!, input.schema, input.table)
    return new Response(stream, {
        headers: {
            'Content-Type':
                input.format === 'csv'
                    ? 'text/csv; charset=utf-8'
                    : 'application/sql; charset=utf-8',
            'Content-Disposition': `attachment; filename="${filename(input.table, input.format)}"`,
            'Cache-Control': 'no-store',
        },
    })
})
