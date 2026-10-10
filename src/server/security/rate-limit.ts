import 'server-only'
import { AppError } from '@/server/errors'

// Fixed-window counters held in memory. Enough for a single app instance (the
// deployment this project targets); a multi-instance deployment would move
// these counters to a shared store. Documented in docs/SECURITY.md.

interface Window {
    count: number
    resetAt: number
}

const windows = new Map<string, Window>()
let lastSweep = Date.now()

export interface RateRule {
    /** Name of the bucket, e.g. 'login'. */
    name: string
    limit: number
    windowMs: number
}

export const RULES = {
    login: { name: 'login', limit: 10, windowMs: 10 * 60_000 },
    register: { name: 'register', limit: 5, windowMs: 60 * 60_000 },
    passwordReset: { name: 'password-reset', limit: 5, windowMs: 60 * 60_000 },
    demo: { name: 'demo', limit: 6, windowMs: 60 * 60_000 },
    query: { name: 'query', limit: 90, windowMs: 60_000 },
    write: { name: 'write', limit: 60, windowMs: 60_000 },
    provision: { name: 'provision', limit: 6, windowMs: 60 * 60_000 },
    import: { name: 'import', limit: 20, windowMs: 60 * 60_000 },
    connectionTest: { name: 'connection-test', limit: 20, windowMs: 10 * 60_000 },
} satisfies Record<string, RateRule>

function sweep(now: number) {
    if (now - lastSweep < 60_000) return
    lastSweep = now
    for (const [key, window] of windows) {
        if (window.resetAt <= now) windows.delete(key)
    }
}

/** Counts one hit against `rule` for `subject`; throws once the limit is passed. */
export function hit(rule: RateRule, subject: string, now = Date.now()) {
    sweep(now)
    const key = `${rule.name}:${subject}`
    const window = windows.get(key)
    if (!window || window.resetAt <= now) {
        windows.set(key, { count: 1, resetAt: now + rule.windowMs })
        return
    }
    window.count += 1
    if (window.count > rule.limit) {
        const seconds = Math.ceil((window.resetAt - now) / 1000)
        throw new AppError('rate_limited', `Too many requests. Try again in ${seconds}s.`, {
            retryAfter: seconds,
        })
    }
}

export function resetRateLimitsForTests() {
    windows.clear()
}
