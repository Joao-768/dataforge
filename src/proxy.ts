import { NextResponse, type NextRequest } from 'next/server'

// Runs before pages render: sets a per-request nonce-based Content Security
// Policy, and sends visitors without a session cookie away from app pages.
// The cookie check is only a fast path; every page and API route verifies
// the session on the server.

const PROTECTED = ['/projects', '/settings']

export function proxy(request: NextRequest) {
    const { pathname } = request.nextUrl
    const hasSession = request.cookies.has('df_session')
    if (
        !hasSession &&
        PROTECTED.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
    ) {
        const url = request.nextUrl.clone()
        url.pathname = '/login'
        url.search = `?next=${encodeURIComponent(pathname)}`
        return NextResponse.redirect(url)
    }

    const nonce = Buffer.from(crypto.randomUUID()).toString('base64')
    const dev = process.env.NODE_ENV === 'development'
    const csp = [
        "default-src 'self'",
        // 'strict-dynamic' lets the nonced scripts load Monaco's chunks.
        `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
        // Monaco and React Flow set inline styles at runtime.
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        "worker-src 'self' blob:",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
    ].join('; ')

    const headers = new Headers(request.headers)
    headers.set('x-nonce', nonce)
    headers.set('Content-Security-Policy', csp)
    const response = NextResponse.next({ request: { headers } })
    response.headers.set('Content-Security-Policy', csp)
    return response
}

export const config = {
    matcher: [
        {
            source: '/((?!api|_next/static|_next/image|monaco|favicon.svg|theme.js).*)',
            missing: [
                { type: 'header', key: 'next-router-prefetch' },
                { type: 'header', key: 'purpose', value: 'prefetch' },
            ],
        },
    ],
}
