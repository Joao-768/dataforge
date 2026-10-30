import { timingSafeEqual } from 'node:crypto'
import { config } from '@/server/config'
import { sweep } from '@/server/demo/service'
import { AppError, notFound } from '@/server/errors'
import { publicRoute } from '@/server/http/route'

// The housekeeping sweep that bootstrap.ts runs on a timer, triggered from
// outside instead. On Vercel a function only runs while it serves a request,
// so a scheduler (cron-job.org) calls this with
// `Authorization: Bearer <CRON_SECRET>`. Without CRON_SECRET the route does
// not exist.
export const POST = publicRoute(async ({ request }) => {
    const secret = config().CRON_SECRET
    if (!secret) throw notFound()
    if (!matches(request.headers.get('authorization'), `Bearer ${secret}`)) {
        throw new AppError('unauthorized', 'Invalid cron secret.')
    }
    await sweep()
    return { status: 'ok' }
})

// Constant-time comparison, so the response time says nothing about the secret.
function matches(given: string | null, expected: string): boolean {
    const a = Buffer.from(given ?? '')
    const b = Buffer.from(expected)
    return a.length === b.length && timingSafeEqual(a, b)
}
