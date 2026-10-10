import 'server-only'
import { NextResponse } from 'next/server'
import { z, ZodError } from 'zod'
import { currentUser, type SessionUser } from '@/server/auth/session'
import { config } from '@/server/config'
import { AppError } from '@/server/errors'
import { log } from '@/server/logger'
import { hit, type RateRule } from '@/server/security/rate-limit'

// Every API route handler is wrapped by `route()`, which applies the same
// guarantees everywhere:
//   - state-changing requests must come from this app's own origin (CSRF);
//   - authenticated routes reject requests without a valid session;
//   - bodies and params are validated with zod before the handler runs;
//   - errors become structured JSON; unexpected ones are logged and masked.

interface BaseContext {
    request: Request
    ip: string
    params: Record<string, string>
    /** Parses the JSON body with `schema`; throws a 422 on invalid input. */
    body<T extends z.ZodType>(schema: T): Promise<z.infer<T>>
    /** Parses the query string with `schema`. */
    search<T extends z.ZodType>(schema: T): z.infer<T>
}

export interface AuthedContext extends BaseContext {
    user: SessionUser
}

type Options = {
    rateLimit?: RateRule
    /** Rate-limit key: by client IP (default) or by signed-in user. */
    rateBy?: 'ip' | 'user'
}

type RouteArgs = { params?: Promise<Record<string, string | string[]> | undefined> }

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export function clientIp(request: Request): string {
    const forwarded = request.headers.get('x-forwarded-for')
    if (!forwarded) return 'unknown'
    const hops = forwarded.split(',').map((part) => part.trim())
    // Behind a trusted reverse proxy, the proxy appends the real client
    // address last. Without one the header is client-supplied.
    return (config().TRUST_PROXY ? hops.at(-1) : hops[0]) || 'unknown'
}

export function assertSameOrigin(request: Request) {
    if (!MUTATING.has(request.method)) return
    const fetchSite = request.headers.get('sec-fetch-site')
    if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
        throw new AppError('forbidden', 'Cross-site request rejected.')
    }
    const origin = request.headers.get('origin')
    if (!origin) {
        // Browsers always send Origin on cross-origin POSTs; a missing header
        // on a mutating request is only accepted from non-browser clients
        // that also omit Sec-Fetch-Site.
        if (fetchSite) throw new AppError('forbidden', 'Missing Origin header.')
        return
    }
    const allowed = new Set([new URL(config().APP_URL).origin])
    const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
    if (host) {
        const proto =
            request.headers.get('x-forwarded-proto') ??
            new URL(request.url).protocol.replace(':', '')
        allowed.add(`${proto}://${host}`)
    }
    if (!allowed.has(origin)) throw new AppError('forbidden', 'Cross-site request rejected.')
}

function flatParams(raw: Record<string, string | string[]> | undefined): Record<string, string> {
    if (!raw) return {}
    return Object.fromEntries(
        Object.entries(raw).map(([key, value]) => [
            key,
            Array.isArray(value) ? value.join('/') : value,
        ]),
    )
}

function makeContext(request: Request, params: Record<string, string>): BaseContext {
    return {
        request,
        params,
        ip: clientIp(request),
        async body(schema) {
            let raw: unknown
            try {
                raw = await request.json()
            } catch {
                throw new AppError('bad_request', 'Request body must be valid JSON.')
            }
            return schema.parse(raw)
        },
        search(schema) {
            const url = new URL(request.url)
            return schema.parse(Object.fromEntries(url.searchParams))
        },
    }
}

export function errorResponse(error: unknown): NextResponse {
    if (error instanceof AppError) {
        const headers: Record<string, string> = {}
        const retry = (error.details as { retryAfter?: number } | undefined)?.retryAfter
        if (retry) headers['Retry-After'] = String(retry)
        return NextResponse.json(
            { error: { code: error.code, message: error.message, details: error.details ?? null } },
            { status: error.status, headers },
        )
    }
    if (error instanceof ZodError) {
        return NextResponse.json(
            {
                error: {
                    code: 'validation_failed',
                    message: error.issues[0]?.message ?? 'Invalid input.',
                    details: error.issues.map((issue) => ({
                        path: issue.path.join('.'),
                        message: issue.message,
                    })),
                },
            },
            { status: 422 },
        )
    }
    log.error({ err: error }, 'unhandled API error')
    return NextResponse.json(
        {
            error: {
                code: 'internal',
                message: 'Something went wrong on our side.',
                details: null,
            },
        },
        { status: 500 },
    )
}

function toResponse(result: unknown): Response {
    if (result instanceof Response) return result
    if (result === undefined) return new NextResponse(null, { status: 204 })
    return NextResponse.json(result)
}

/** A public route (no session required). */
export function publicRoute(
    handler: (ctx: BaseContext) => Promise<unknown>,
    options: Options = {},
) {
    return async (request: Request, args: RouteArgs) => {
        try {
            assertSameOrigin(request)
            const ctx = makeContext(request, flatParams(await args?.params))
            if (options.rateLimit) hit(options.rateLimit, ctx.ip)
            return toResponse(await handler(ctx))
        } catch (error) {
            return errorResponse(error)
        }
    }
}

/** A route that requires a signed-in user. */
export function authedRoute(
    handler: (ctx: AuthedContext) => Promise<unknown>,
    options: Options = {},
) {
    return async (request: Request, args: RouteArgs) => {
        try {
            assertSameOrigin(request)
            const user = await currentUser()
            if (!user) throw new AppError('unauthorized', 'Sign in to continue.')
            const ctx: AuthedContext = {
                ...makeContext(request, flatParams(await args?.params)),
                user,
            }
            if (options.rateLimit) {
                hit(options.rateLimit, options.rateBy === 'ip' ? ctx.ip : `user:${user.id}`)
            }
            return toResponse(await handler(ctx))
        } catch (error) {
            return errorResponse(error)
        }
    }
}
