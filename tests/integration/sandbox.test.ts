import pg from 'pg'
import { describe, expect, it } from 'vitest'
import { one } from '@/server/db/app-db'
import { deleteProject } from '@/server/projects/service'
import { decryptSecret } from '@/server/security/crypto'
import { checkConnection, getConnection, projectTarget } from '@/server/targets/connections'
import { adminPool } from '@/server/targets/provisioner'
import { createProjectWithSandbox, createUser } from '../support/factory'

async function connect(target: {
    host: string
    port: number
    database: string
    user: string
    password: string
}) {
    const { host, port, database, user, password } = target
    const client = new pg.Client({
        host,
        port,
        database,
        user,
        password,
        ssl: false,
        connectionTimeoutMillis: 5000,
    })
    await client.connect()
    return client
}

describe('managed sandboxes', () => {
    it('clones the demo template with its data and reports it', async () => {
        const owner = await createUser()
        const projectId = await createProjectWithSandbox(owner, 'ecommerce')
        const connection = await checkConnection(owner.user.id, projectId)
        expect(connection).toMatchObject({ kind: 'managed', status: 'ready', tableCount: 6 })
        expect(connection.database).toMatch(/^df_[a-f0-9]{12}$/)
        expect(JSON.stringify(await getConnection(owner.user.id, projectId))).not.toMatch(
            /password/i,
        )
    })

    it('stores encrypted passwords that only the server can read', async () => {
        const owner = await createUser()
        const projectId = await createProjectWithSandbox(owner, 'empty')
        const row = await one<{ id: string; read_password_enc: string }>(
            'SELECT id, read_password_enc FROM connections WHERE project_id = $1',
            [projectId],
        )
        expect(row!.read_password_enc).toMatch(/^v1:/)
        expect(decryptSecret(row!.read_password_enc, row!.id)).toHaveLength(32)
    })

    it('gives the read role SELECT only, and keeps both roles inside their database', async () => {
        const owner = await createUser()
        const first = await createProjectWithSandbox(owner, 'ecommerce')
        const second = await createProjectWithSandbox(owner, 'empty')
        const reader = (await projectTarget(owner.user.id, first, 'read')).credentials
        const writer = (await projectTarget(owner.user.id, first, 'write')).credentials
        const other = (await projectTarget(owner.user.id, second, 'read')).credentials

        const readClient = await connect(reader)
        try {
            expect((await readClient.query('SELECT count(*)::int AS n FROM users')).rows[0].n).toBe(
                600,
            )
            // default_transaction_read_only is on for the role, and it has no
            // write privilege even when that is switched off.
            await expect(readClient.query('DELETE FROM payments')).rejects.toThrow(
                /read-only transaction/,
            )
            await readClient.query('SET default_transaction_read_only = off')
            await expect(readClient.query('DELETE FROM payments')).rejects.toThrow(
                /permission denied/,
            )
            await expect(readClient.query('CREATE TEMP TABLE scratch (x int)')).rejects.toThrow(
                /permission denied/,
            )
            await expect(readClient.query("SELECT pg_read_file('/etc/passwd')")).rejects.toThrow(
                /permission denied/,
            )
        } finally {
            await readClient.end()
        }

        const writeClient = await connect(writer)
        try {
            await writeClient.query('CREATE TABLE scratch (x int)')
            await expect(writeClient.query('CREATE SCHEMA elsewhere')).rejects.toThrow(
                /permission denied/,
            )
            await expect(writeClient.query('CREATE ROLE intruder')).rejects.toThrow(
                /permission denied/,
            )
        } finally {
            await writeClient.end()
        }

        // The new table is readable by the read role (default privileges).
        const again = await connect(reader)
        await again.query('SELECT * FROM scratch')
        await again.end()

        // Neither role may connect to another sandbox, the template or the admin database.
        for (const database of [
            other.database,
            'df_template_ecommerce',
            'dataforge_admin',
            'postgres',
        ]) {
            await expect(connect({ ...writer, database })).rejects.toThrow(
                /permission denied|CONNECT privilege/,
            )
        }
    })

    it('drops the database and its roles when the project is deleted', async () => {
        const owner = await createUser()
        const projectId = await createProjectWithSandbox(owner, 'empty')
        const { database } = (await getConnection(owner.user.id, projectId))!
        await deleteProject(owner.user.id, projectId)
        const remaining = await adminPool().query('SELECT 1 FROM pg_database WHERE datname = $1', [
            database,
        ])
        expect(remaining.rowCount).toBe(0)
        const roles = await adminPool().query('SELECT 1 FROM pg_roles WHERE rolname LIKE $1', [
            `${database}%`,
        ])
        expect(roles.rowCount).toBe(0)
    })

    it('limits sandboxes per user', async () => {
        const owner = await createUser()
        await createProjectWithSandbox(owner, 'empty')
        await createProjectWithSandbox(owner, 'empty')
        await createProjectWithSandbox(owner, 'empty')
        await expect(createProjectWithSandbox(owner, 'empty')).rejects.toThrow(
            /up to 3 sandbox databases/,
        )
    })
})
