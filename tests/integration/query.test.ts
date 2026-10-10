import { describe, expect, it } from 'vitest'
import { listHistory } from '@/server/query/history'
import { executeScript, explainStatement } from '@/server/query/executor'
import { cancelRun } from '@/server/query/session'
import { createProjectWithSandbox, createUser, type TestUser } from '../support/factory'

let owner: TestUser
let projectId: string

async function setup() {
    owner ??= await createUser()
    projectId ??= await createProjectWithSandbox(owner, 'ecommerce')
}

const run = (
    sql: string,
    mode: 'read' | 'write' = 'read',
    extra: { runId?: string; maxRows?: number } = {},
) => executeScript(owner.user.id, projectId, { sql, mode, ...extra })

describe('query execution', () => {
    it('runs a script and returns typed results per statement', async () => {
        await setup()
        const result = await run(
            'select count(*) as n from orders; select id, price, attributes, is_active, created_at from products order by id limit 2',
        )
        expect(result.status).toBe('success')
        expect(result.results).toHaveLength(2)
        const [count, rows] = result.results
        expect(count!.fields).toEqual([{ name: 'n', type: 'bigint' }])
        expect(rows!.fields.map((field) => field.type)).toEqual([
            'bigint',
            'numeric',
            'jsonb',
            'boolean',
            'timestamptz',
        ])
        // bigint and numeric arrive as exact strings, jsonb as an object.
        expect(typeof rows!.rows[0]![0]).toBe('string')
        expect(typeof rows!.rows[0]![1]).toBe('string')
        expect(typeof rows!.rows[0]![2]).toBe('object')
    })

    it('refuses writes in read mode, at the database', async () => {
        await setup()
        const result = await run('delete from payments')
        expect(result.status).toBe('error')
        expect(result.error?.message).toMatch(/read-only transaction/)
        expect(result.error?.code).toBe('25006')
    })

    it('cannot be talked out of read-only mode', async () => {
        await setup()
        const viaFunction = await run(
            "select set_config('transaction_read_only', 'off', true); delete from payments",
        )
        expect(viaFunction.status).toBe('error')
        await expect(run('commit; delete from payments')).rejects.toThrow(/controls transactions/)
        await expect(run('begin; delete from payments')).rejects.toThrow(/controls transactions/)
        const count = await run('select count(*)::int from payments')
        expect(count.results[0]!.rows[0]![0]).toBeGreaterThan(3000)
    })

    it('runs one statement per protocol message', async () => {
        await setup()
        // Even a script that hides two statements in one is executed one by one.
        const result = await run('select 1; select 2; select 3')
        expect(result.results.map((entry) => entry.rows[0]![0])).toEqual([1, 2, 3])
    })

    it('commits write scripts only when every statement succeeds', async () => {
        await setup()
        const failed = await run(
            'update products set stock = 9999 where id = 1; select 1/0',
            'write',
        )
        expect(failed).toMatchObject({ status: 'error', committed: false })
        expect(failed.error?.statementIndex).toBe(1)
        const unchanged = await run('select stock from products where id = 1')
        expect(unchanged.results[0]!.rows[0]![0]).not.toBe(9999)

        const ok = await run(
            'update products set stock = 4242 where id = 1 returning stock',
            'write',
        )
        expect(ok).toMatchObject({ status: 'success', committed: true })
        const changed = await run('select stock from products where id = 1')
        expect(changed.results[0]!.rows[0]![0]).toBe(4242)
    })

    it('reports error positions relative to the script', async () => {
        await setup()
        const sql = 'select 1;\nselect nonexistent_column from users'
        const result = await run(sql)
        expect(result.error?.position).toBe(sql.indexOf('nonexistent_column'))
    })

    it('truncates large results at the portal instead of loading them', async () => {
        await setup()
        const result = await run('select * from order_items', 'read', { maxRows: 100 })
        expect(result.results[0]).toMatchObject({ truncated: true, rowCount: null })
        expect(result.results[0]!.rows).toHaveLength(100)
    })

    it('stops queries that disable their own timeout', async () => {
        await setup()
        const started = Date.now()
        const result = await run('set statement_timeout = 0; select pg_sleep(30)')
        expect(result.status).toBe('timeout')
        expect(Date.now() - started).toBeLessThan(10_000)
    })

    it('cancels a running query on request, and only for its owner', async () => {
        await setup()
        const runId = crypto.randomUUID()
        const pending = run('select pg_sleep(20)', 'read', { runId })
        await new Promise((resolve) => setTimeout(resolve, 500))
        const intruder = await createUser()
        expect(await cancelRun(intruder.user.id, runId)).toBe(false)
        expect(await cancelRun(owner.user.id, runId)).toBe(true)
        const result = await pending
        expect(result.status).toBe('cancelled')
    })

    it('does not leak session state between runs', async () => {
        await setup()
        await run(
            "set search_path = pg_catalog; select set_config('application_name', 'leaked', false)",
        )
        const after = await run(
            "select current_setting('search_path'), current_setting('application_name')",
        )
        expect(after.results[0]!.rows[0]).toEqual(['"$user", public', 'dataforge'])
    })

    it('records history without result data', async () => {
        await setup()
        await run("select 'secret-value' as v")
        const [latest] = await listHistory(projectId, owner.user.id, 1)
        expect(latest).toMatchObject({ status: 'success', mode: 'read', rowCount: 1 })
        expect(JSON.stringify(latest)).not.toMatch(/secret-value"\]/)
    })
})

describe('EXPLAIN', () => {
    it('returns an estimated plan without executing', async () => {
        await setup()
        const select = await explainStatement(owner.user.id, projectId, {
            sql: 'select * from orders where user_id = 7',
            analyze: false,
            mode: 'read',
        })
        expect(select.analyzed).toBe(false)
        expect(select.executionMs).toBeNull()
        // Planning a write needs the write role's privileges, but it still runs nothing.
        const before = await run('select count(*)::int from payments')
        await explainStatement(owner.user.id, projectId, {
            sql: 'delete from payments',
            analyze: false,
            mode: 'write',
        })
        expect((await run('select count(*)::int from payments')).results[0]!.rows).toEqual(
            before.results[0]!.rows,
        )
    })

    it('measures with ANALYZE and always rolls back', async () => {
        await setup()
        const before = await run('select count(*)::int from payments')
        const result = await explainStatement(owner.user.id, projectId, {
            sql: 'delete from payments',
            analyze: true,
            mode: 'write',
        })
        expect(result.analyzed).toBe(true)
        expect(result.executionMs).not.toBeNull()
        const after = await run('select count(*)::int from payments')
        expect(after.results[0]!.rows[0]![0]).toBe(before.results[0]!.rows[0]![0])
    })

    it('refuses ANALYZE of a write in read mode', async () => {
        await setup()
        await expect(
            explainStatement(owner.user.id, projectId, {
                sql: 'delete from payments',
                analyze: true,
                mode: 'read',
            }),
        ).rejects.toThrow(/read-only transaction/)
    })

    it('explains exactly one statement', async () => {
        await setup()
        await expect(
            explainStatement(owner.user.id, projectId, {
                sql: 'select 1; select 2',
                analyze: false,
                mode: 'read',
            }),
        ).rejects.toThrow(/single statement/)
    })
})
