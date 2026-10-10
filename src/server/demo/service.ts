import 'server-only'
import { randomBytes } from 'node:crypto'
import { hashPassword } from '@/server/auth/password'
import { createSession } from '@/server/auth/session'
import { config } from '@/server/config'
import { one, query } from '@/server/db/app-db'
import { AppError } from '@/server/errors'
import { log } from '@/server/logger'
import { deleteProject } from '@/server/projects/service'
import { hit, type RateRule } from '@/server/security/rate-limit'
import { EXAMPLE_QUERIES } from '@/server/demo/examples'
import { provisionManaged } from '@/server/targets/connections'
import { dropSandbox, listSandboxDatabases } from '@/server/targets/provisioner'
import { recordActivity } from '@/server/activity'

// The public demo. Every visitor gets a guest account with its own project
// and its own copy of the e-commerce database, cloned from the template in
// well under a second. Nothing is shared between visitors, so nobody can
// break the demo for anyone else. Guests expire after DEMO_TTL_HOURS and a
// background sweep drops their databases.

const DEMO_GLOBAL: RateRule = { name: 'demo-global', limit: 120, windowMs: 60 * 60_000 }

export async function startDemo(
    ip: string,
    userAgent: string | null,
): Promise<{ projectId: string }> {
    if (!config().DEMO_ENABLED)
        throw new AppError('unsupported', 'The demo is not enabled on this deployment.')
    // A global ceiling on top of the per-IP limit, because client addresses
    // can be spoofed when no trusted proxy is configured.
    hit(DEMO_GLOBAL, 'all')
    const active = await one<{ count: string }>(
        'SELECT count(*) FROM users WHERE is_guest AND expires_at > now()',
    )
    if (Number(active!.count) >= config().DEMO_MAX_ACTIVE) {
        throw new AppError(
            'capacity_reached',
            'All demo databases are in use right now. Try again in a little while, or create a free account.',
        )
    }

    const suffix = randomBytes(6).toString('hex')
    const user = await one<{ id: string }>(
        `INSERT INTO users (email, name, password_hash, is_guest, expires_at)
         VALUES ($1, 'Demo visitor', $2, true, now() + make_interval(hours => $3))
         RETURNING id`,
        [
            `guest-${suffix}@demo.dataforge.local`,
            await hashPassword(randomBytes(24).toString('hex')),
            config().DEMO_TTL_HOURS,
        ],
    )
    const userId = user!.id
    await query('INSERT INTO user_settings (user_id) VALUES ($1)', [userId])

    try {
        const project = await one<{ id: string }>(
            `INSERT INTO projects (owner_id, name, description) VALUES ($1, $2, $3) RETURNING id`,
            [
                userId,
                'Storefront',
                'A sample e-commerce database: customers, products, categories, orders, order items and payments.',
            ],
        )
        const projectId = project!.id
        await recordActivity({
            userId,
            projectId,
            kind: 'project.created',
            message: 'Created project Storefront',
        })
        await provisionManaged(userId, projectId, 'ecommerce', { isGuest: true })
        for (const example of EXAMPLE_QUERIES) {
            await query(
                'INSERT INTO saved_queries (project_id, user_id, name, sql) VALUES ($1, $2, $3, $4)',
                [projectId, userId, example.name, example.sql],
            )
        }
        await createSession(userId, userAgent)
        log.info({ ip }, 'demo started')
        return { projectId }
    } catch (error) {
        await removeGuest(userId).catch(() => undefined)
        throw error
    }
}

async function removeGuest(userId: string) {
    const projects = await query<{ id: string }>('SELECT id FROM projects WHERE owner_id = $1', [
        userId,
    ])
    for (const project of projects.rows) await deleteProject(userId, project.id)
    await query('DELETE FROM users WHERE id = $1 AND is_guest', [userId])
}

/**
 * Housekeeping, run on an interval: expired guests and their databases,
 * expired sessions and reset tokens, and sandbox databases that no
 * connection refers to (left behind if the app stopped mid-provisioning).
 */
export async function sweep(): Promise<void> {
    const expired = await query<{ id: string }>(
        'SELECT id FROM users WHERE is_guest AND expires_at < now() LIMIT 50',
    )
    for (const guest of expired.rows) {
        try {
            await removeGuest(guest.id)
        } catch (error) {
            log.error({ err: error, userId: guest.id }, 'could not remove expired guest')
        }
    }
    await query('DELETE FROM sessions WHERE expires_at < now()')
    await query(`DELETE FROM password_reset_tokens WHERE expires_at < now() - interval '1 day'`)

    const known = new Set(
        (
            await query<{ database_name: string }>(
                `SELECT database_name FROM connections WHERE kind = 'managed'`,
            )
        ).rows.map((row) => row.database_name),
    )
    for (const database of await listSandboxDatabases()) {
        if (known.has(database)) continue
        // A brand-new sandbox may not be recorded yet; only drop ones that
        // are still unknown on the next sweep.
        if (!orphanCandidates.has(database)) {
            orphanCandidates.add(database)
            continue
        }
        orphanCandidates.delete(database)
        log.warn({ database }, 'dropping orphaned sandbox database')
        await dropSandbox(database).catch((error) =>
            log.error({ err: error, database }, 'orphan drop failed'),
        )
    }
    if (expired.rowCount) log.info({ removed: expired.rowCount }, 'expired demo guests removed')
}

const orphanCandidates = new Set<string>()
