import 'server-only'
import { headers } from 'next/headers'
import { decoyHash, hashPassword, verifyPassword } from '@/server/auth/password'
import {
    createSession,
    destroyCurrentSession,
    destroyOtherSessions,
    type SessionUser,
} from '@/server/auth/session'
import { config } from '@/server/config'
import { one, query, transaction } from '@/server/db/app-db'
import { AppError } from '@/server/errors'
import { sendMail } from '@/server/mail'
import { deleteAllProjectsOf } from '@/server/projects/service'
import { randomToken, sha256 } from '@/server/security/crypto'
import { hit, RULES } from '@/server/security/rate-limit'
import type { z } from 'zod'
import type {
    changePasswordSchema,
    loginSchema,
    profileSchema,
    registerSchema,
    settingsSchema,
} from '@/shared/validation'

const RESET_TOKEN_MINUTES = 60

export interface PublicUser {
    id: string
    email: string
    name: string
    isGuest: boolean
    expiresAt: string | null
}

export function toPublicUser(user: SessionUser): PublicUser {
    return {
        id: user.id,
        email: user.email,
        name: user.name,
        isGuest: user.isGuest,
        expiresAt: user.expiresAt,
    }
}

async function userAgent() {
    return (await headers()).get('user-agent')
}

function isUniqueViolation(error: unknown) {
    return (error as { code?: string }).code === '23505'
}

export async function register(input: z.infer<typeof registerSchema>) {
    const passwordHash = await hashPassword(input.password)
    let userId: string
    try {
        userId = await transaction(async (db) => {
            const created = await db.query<{ id: string }>(
                `INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id`,
                [input.email, input.name, passwordHash],
            )
            const id = created.rows[0]!.id
            await db.query('INSERT INTO user_settings (user_id) VALUES ($1)', [id])
            return id
        })
    } catch (error) {
        if (isUniqueViolation(error)) {
            throw new AppError('conflict', 'An account with this email already exists.')
        }
        throw error
    }
    await createSession(userId, await userAgent())
}

export async function login(input: z.infer<typeof loginSchema>) {
    // Per-account limit on top of the per-IP one, so rotating addresses does
    // not allow unlimited guesses against a single account.
    hit(RULES.login, `email:${input.email}`)
    const user = await one<{ id: string; password_hash: string }>(
        `SELECT id, password_hash FROM users WHERE lower(email) = $1 AND NOT is_guest`,
        [input.email],
    )
    const valid = await verifyPassword(input.password, user?.password_hash ?? (await decoyHash()))
    if (!user || !valid) throw new AppError('unauthorized', 'Email or password is incorrect.')
    await createSession(user.id, await userAgent())
}

export async function logout() {
    await destroyCurrentSession()
}

export async function requestPasswordReset(email: string) {
    hit(RULES.passwordReset, `email:${email}`)
    const user = await one<{ id: string; name: string }>(
        `SELECT id, name FROM users WHERE lower(email) = $1 AND NOT is_guest`,
        [email],
    )
    // Same response whether or not the account exists.
    if (!user) return
    const token = randomToken()
    await query(
        `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
         VALUES ($1, $2, now() + make_interval(mins => $3))`,
        [user.id, sha256(token), RESET_TOKEN_MINUTES],
    )
    const link = new URL(`/reset-password?token=${token}`, config().APP_URL).toString()
    await sendMail({
        to: email,
        subject: 'Reset your DataForge password',
        text: [
            `Hi ${user.name},`,
            '',
            'Someone asked to reset the password for your DataForge account.',
            `Open this link within ${RESET_TOKEN_MINUTES} minutes to choose a new one:`,
            '',
            link,
            '',
            'If it was not you, ignore this email. Your password stays the same.',
        ].join('\n'),
    })
}

export async function resetPassword(token: string, password: string) {
    const passwordHash = await hashPassword(password)
    await transaction(async (db) => {
        // Claim the token atomically so it can only ever be used once.
        const claimed = await db.query<{ user_id: string }>(
            `UPDATE password_reset_tokens
             SET used_at = now()
             WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
             RETURNING user_id`,
            [sha256(token)],
        )
        const userId = claimed.rows[0]?.user_id
        if (!userId) {
            throw new AppError('bad_request', 'This reset link is invalid or has expired.')
        }
        await db.query('UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1', [
            userId,
            passwordHash,
        ])
        // A reset signs the account out everywhere.
        await db.query('DELETE FROM sessions WHERE user_id = $1', [userId])
        await db.query(
            'UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL',
            [userId],
        )
    })
}

function assertNotGuest(user: SessionUser) {
    if (user.isGuest) {
        throw new AppError(
            'forbidden',
            'Demo accounts cannot change account details. Create a free account to keep your work.',
        )
    }
}

export async function updateProfile(user: SessionUser, input: z.infer<typeof profileSchema>) {
    assertNotGuest(user)
    try {
        await query('UPDATE users SET name = $2, email = $3, updated_at = now() WHERE id = $1', [
            user.id,
            input.name,
            input.email,
        ])
    } catch (error) {
        if (isUniqueViolation(error)) {
            throw new AppError('conflict', 'Another account already uses this email.')
        }
        throw error
    }
}

export async function changePassword(
    user: SessionUser,
    input: z.infer<typeof changePasswordSchema>,
) {
    assertNotGuest(user)
    const row = await one<{ password_hash: string }>(
        'SELECT password_hash FROM users WHERE id = $1',
        [user.id],
    )
    if (!row || !(await verifyPassword(input.currentPassword, row.password_hash))) {
        throw new AppError('validation_failed', 'Your current password is incorrect.', [
            { path: 'currentPassword', message: 'Your current password is incorrect.' },
        ])
    }
    await query('UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1', [
        user.id,
        await hashPassword(input.newPassword),
    ])
    await destroyOtherSessions(user.id, user.sessionId)
}

export async function deleteAccount(user: SessionUser, password: string | undefined) {
    if (!user.isGuest) {
        const row = await one<{ password_hash: string }>(
            'SELECT password_hash FROM users WHERE id = $1',
            [user.id],
        )
        if (!row || !password || !(await verifyPassword(password, row.password_hash))) {
            throw new AppError('validation_failed', 'Your password is incorrect.', [
                { path: 'password', message: 'Your password is incorrect.' },
            ])
        }
    }
    // Drop managed databases first; the app rows cascade from the user.
    await deleteAllProjectsOf(user.id)
    await query('DELETE FROM users WHERE id = $1', [user.id])
    await destroyCurrentSession()
}

export interface UserSettings {
    editorFontSize: number
    defaultRowLimit: number
    confirmWriteQueries: boolean
}

export async function getSettings(userId: string): Promise<UserSettings> {
    const row = await one<{
        editor_font_size: number
        default_row_limit: number
        confirm_write_queries: boolean
    }>(
        `INSERT INTO user_settings (user_id) VALUES ($1)
         ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id
         RETURNING editor_font_size, default_row_limit, confirm_write_queries`,
        [userId],
    )
    return {
        editorFontSize: row!.editor_font_size,
        defaultRowLimit: row!.default_row_limit,
        confirmWriteQueries: row!.confirm_write_queries,
    }
}

export async function updateSettings(userId: string, input: z.infer<typeof settingsSchema>) {
    await query(
        `INSERT INTO user_settings (user_id, editor_font_size, default_row_limit, confirm_write_queries)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id) DO UPDATE SET
             editor_font_size = EXCLUDED.editor_font_size,
             default_row_limit = EXCLUDED.default_row_limit,
             confirm_write_queries = EXCLUDED.confirm_write_queries,
             updated_at = now()`,
        [userId, input.editorFontSize, input.defaultRowLimit, input.confirmWriteQueries],
    )
}
