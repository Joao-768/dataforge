import { AppError } from '@/server/errors'
import { authedRoute } from '@/server/http/route'
import { RULES } from '@/server/security/rate-limit'
import { importCsv, importOptionsSchema } from '@/server/transfer/csv-import'
import { config } from '@/server/config'

// The CSV file is the raw request body (streamed, never buffered whole);
// import options travel in the query string.
export const POST = authedRoute(
    async (ctx) => {
        const url = new URL(ctx.request.url)
        let options: unknown
        try {
            options = JSON.parse(url.searchParams.get('options') ?? '')
        } catch {
            throw new AppError('bad_request', 'Missing import options.')
        }
        const declared = Number(ctx.request.headers.get('content-length') ?? 0)
        if (declared > config().IMPORT_MAX_BYTES) {
            throw new AppError(
                'payload_too_large',
                `The file is larger than ${Math.round(config().IMPORT_MAX_BYTES / 1024 / 1024)} MB.`,
            )
        }
        if (!ctx.request.body) throw new AppError('bad_request', 'The file is empty.')
        return importCsv(
            ctx.user.id,
            ctx.params.projectId!,
            ctx.request.body,
            importOptionsSchema.parse(options),
        )
    },
    { rateLimit: RULES.import },
)
