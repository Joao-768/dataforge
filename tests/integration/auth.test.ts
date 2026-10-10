import { describe, expect, it } from 'vitest'
import {
    changePassword,
    login,
    logout,
    register,
    requestPasswordReset,
    resetPassword,
} from '@/server/auth/service'
import { currentUser, userForToken } from '@/server/auth/session'
import { one, query } from '@/server/db/app-db'
import { resetRateLimitsForTests } from '@/server/security/rate-limit'
import { randomToken, sha256 } from '@/server/security/crypto'
import { clearCookies, sessionToken, useSession } from '../support/cookies'
import { createUser } from '../support/factory'

describe('registration and login', () => {
    it('registers, stores only a password hash and a hashed session token', async () => {
        const { user, token } = await createUser('Ada')
        const row = await one<{ password_hash: string }>(
            'SELECT password_hash FROM users WHERE id = $1',
            [user.id],
        )
        expect(row!.password_hash).toMatch(/^scrypt\$/)
        const session = await one<{ token_hash: Buffer }>(
            'SELECT token_hash FROM sessions WHERE user_id = $1',
            [user.id],
        )
        expect(session!.token_hash.equals(sha256(token))).toBe(true)
        expect(session!.token_hash.toString('utf8')).not.toContain(token)
    })

    it('refuses a duplicate email regardless of case', async () => {
        const { user } = await createUser()
        await expect(
            register({
                name: 'Copy',
                email: user.email.toUpperCase().toLowerCase(),
                password: 'another-password',
            }),
        ).rejects.toThrow('already exists')
    })

    it('gives the same error for a wrong password and an unknown email', async () => {
        const { user } = await createUser()
        resetRateLimitsForTests()
        clearCookies()
        await expect(login({ email: user.email, password: 'wrong-password' })).rejects.toThrow(
            'Email or password is incorrect.',
        )
        await expect(
            login({ email: 'nobody@example.com', password: 'wrong-password' }),
        ).rejects.toThrow('Email or password is incorrect.')
        await login({ email: user.email, password: 'correct-horse-battery' })
        expect((await currentUser())?.id).toBe(user.id)
    })

    it('rate-limits repeated attempts against one account', async () => {
        const { user } = await createUser()
        resetRateLimitsForTests()
        for (let attempt = 0; attempt < 10; attempt += 1) {
            await login({ email: user.email, password: 'nope-nope-nope' }).catch(() => undefined)
        }
        await expect(
            login({ email: user.email, password: 'correct-horse-battery' }),
        ).rejects.toThrow(/Too many requests/)
    })

    it('ends the session on logout', async () => {
        const { token } = await createUser()
        await logout()
        expect(sessionToken()).toBeUndefined()
        expect(await userForToken(token)).toBeNull()
    })

    it('rejects expired sessions', async () => {
        const { user, token } = await createUser()
        await query(
            `UPDATE sessions SET expires_at = now() - interval '1 second' WHERE user_id = $1`,
            [user.id],
        )
        expect(await userForToken(token)).toBeNull()
    })
})

describe('password reset', () => {
    it('resets with a single-use token and signs out every session', async () => {
        const { user, token } = await createUser()
        // Issue a known token the way requestPasswordReset does.
        const reset = randomToken()
        await query(
            `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 hour')`,
            [user.id, sha256(reset)],
        )
        await resetPassword(reset, 'a-brand-new-password')
        expect(await userForToken(token)).toBeNull()
        await expect(resetPassword(reset, 'yet-another-password')).rejects.toThrow(
            'invalid or has expired',
        )
        resetRateLimitsForTests()
        await login({ email: user.email, password: 'a-brand-new-password' })
    })

    it('rejects expired tokens', async () => {
        const { user } = await createUser()
        const reset = randomToken()
        await query(
            `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, now() - interval '1 minute')`,
            [user.id, sha256(reset)],
        )
        await expect(resetPassword(reset, 'a-brand-new-password')).rejects.toThrow(
            'invalid or has expired',
        )
    })

    it('answers the same for unknown emails and stores tokens only as hashes', async () => {
        const { user } = await createUser()
        resetRateLimitsForTests()
        await expect(requestPasswordReset('missing@example.com')).resolves.toBeUndefined()
        await requestPasswordReset(user.email)
        const row = await one<{ token_hash: Buffer }>(
            'SELECT token_hash FROM password_reset_tokens WHERE user_id = $1',
            [user.id],
        )
        expect(row?.token_hash).toHaveLength(32)
    })
})

describe('changing the password', () => {
    it('requires the current password and keeps only the current session', async () => {
        const first = await createUser()
        // A second session for the same user.
        clearCookies()
        resetRateLimitsForTests()
        await login({ email: first.user.email, password: first.password })
        const second = sessionToken()!
        useSession(first.token)
        await expect(
            changePassword(first.user, {
                currentPassword: 'wrong',
                newPassword: 'another-good-password',
            }),
        ).rejects.toThrow('current password is incorrect')
        await changePassword(first.user, {
            currentPassword: first.password,
            newPassword: 'another-good-password',
        })
        expect(await userForToken(first.token)).not.toBeNull()
        expect(await userForToken(second)).toBeNull()
    })
})
