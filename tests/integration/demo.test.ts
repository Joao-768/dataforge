import { describe, expect, it } from 'vitest'
import { currentUser } from '@/server/auth/session'
import { one, query } from '@/server/db/app-db'
import { startDemo, sweep } from '@/server/demo/service'
import { listSaved } from '@/server/queries/saved'
import { executeScript } from '@/server/query/executor'
import { resetRateLimitsForTests } from '@/server/security/rate-limit'
import { getConnection } from '@/server/targets/connections'
import { adminPool } from '@/server/targets/provisioner'
import { clearCookies } from '../support/cookies'

async function visitor() {
    clearCookies()
    resetRateLimitsForTests()
    const { projectId } = await startDemo('203.0.113.1', 'test')
    const user = (await currentUser())!
    return { user, projectId }
}

describe('public demo', () => {
    it('gives every visitor a private database with sample data and example queries', async () => {
        const first = await visitor()
        const second = await visitor()
        expect(first.user.isGuest).toBe(true)
        const a = await getConnection(first.user.id, first.projectId)
        const b = await getConnection(second.user.id, second.projectId)
        expect(a!.database).not.toBe(b!.database)
        expect((await listSaved(first.user.id, first.projectId)).length).toBeGreaterThanOrEqual(5)

        // One visitor deleting everything does not touch the other.
        await executeScript(first.user.id, first.projectId, {
            sql: 'truncate payments, order_items, orders cascade',
            mode: 'write',
        })
        const left = await executeScript(second.user.id, second.projectId, {
            sql: 'select count(*)::int from orders',
            mode: 'read',
        })
        expect(left.results[0]!.rows[0]![0]).toBeGreaterThan(1000)
        await expect(
            executeScript(second.user.id, first.projectId, { sql: 'select 1', mode: 'read' }),
        ).rejects.toThrow('Project not found')
    })

    it('removes expired guests and their databases', async () => {
        const guest = await visitor()
        const { database } = (await getConnection(guest.user.id, guest.projectId))!
        await query(`UPDATE users SET expires_at = now() - interval '1 minute' WHERE id = $1`, [
            guest.user.id,
        ])
        await sweep()
        expect(await one('SELECT 1 FROM users WHERE id = $1', [guest.user.id])).toBeNull()
        expect(
            (await adminPool().query('SELECT 1 FROM pg_database WHERE datname = $1', [database]))
                .rowCount,
        ).toBe(0)
    })

    it('stops creating demos at capacity', async () => {
        await query(`UPDATE users SET expires_at = now() + interval '1 hour' WHERE is_guest`)
        const active = await one<{ count: string }>(
            'SELECT count(*) FROM users WHERE is_guest AND expires_at > now()',
        )
        for (let index = Number(active!.count); index < 5; index += 1) await visitor()
        await expect(visitor()).rejects.toThrow(/All demo databases are in use/)
    })
})
