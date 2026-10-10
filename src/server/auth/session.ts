import 'server-only'
import { cookies } from 'next/headers'
import { config } from '@/server/config'
import { one, query } from '@/server/db/app-db'
import { randomToken, sha256 } from '@/server/security/crypto'

// Server-side sessions. The browser holds a random token in an HttpOnly,
// SameSite=Lax cookie; the database holds only its SHA-256, so neither a
// database leak nor a log line can be replayed as a session.

export const SESSION_COOKIE = 'df_session'
const SESSION_DAYS = 14
// Sliding expiry is refreshed at most this often, to avoid a write per request.
const TOUCH_INTERVAL_MS = 10 * 60_000

export interface SessionUser {
    id: string
    email: string
    name: string
    isGuest: boolean
    expiresAt: string | null
    sessionId: string
}

export async function createSession(userId: string, userAgent: string | null) {
    const token = randomToken()
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000)
    await query(
        `INSERT INTO sessions (user_id, token_hash, user_agent, expires_at)
         VALUES ($1, $2, $3, $4)`,
        [userId, sha256(token), userAgent?.slice(0, 300) ?? null, expiresAt],
    )
    const jar = await cookies()
    jar.set(SESSION_COOKIE, token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: config().secureCookies,
        path: '/',
        expires: expiresAt,
    })
}

export async function readSessionToken(): Promise<string | null> {
    const jar = await cookies()
    return jar.get(SESSION_COOKIE)?.value ?? null
}

export async function userForToken(token: string): Promise<SessionUser | null> {
    const row = await one<{
        session_id: string
        last_seen_at: Date
        id: string
        email: string
        name: string
        is_guest: boolean
        expires_at: Date | null
    }>(
        `SELECT s.id AS session_id, s.last_seen_at, u.id, u.email, u.name, u.is_guest, u.expires_at
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = $1
           AND s.expires_at > now()
           AND (u.expires_at IS NULL OR u.expires_at > now())`,
        [sha256(token)],
    )
    if (!row) return null
    if (Date.now() - row.last_seen_at.getTime() > TOUCH_INTERVAL_MS) {
        await query(
            `UPDATE sessions
             SET last_seen_at = now(), expires_at = now() + make_interval(days => $2)
             WHERE id = $1`,
            [row.session_id, SESSION_DAYS],
        )
    }
    return {
        id: row.id,
        email: row.email,
        name: row.name,
        isGuest: row.is_guest,
        expiresAt: row.expires_at?.toISOString() ?? null,
        sessionId: row.session_id,
    }
}

/** The signed-in user for the current request, or null. */
export async function currentUser(): Promise<SessionUser | null> {
    const token = await readSessionToken()
    return token ? userForToken(token) : null
}

export async function destroyCurrentSession() {
    const token = await readSessionToken()
    if (token) await query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)])
    const jar = await cookies()
    jar.delete(SESSION_COOKIE)
}

export async function destroyOtherSessions(userId: string, keepSessionId: string) {
    await query('DELETE FROM sessions WHERE user_id = $1 AND id <> $2', [userId, keepSessionId])
}
