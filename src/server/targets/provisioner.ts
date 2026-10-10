import 'server-only'
import { createHash, randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import pg from 'pg'
import { config } from '@/server/config'
import { AppError } from '@/server/errors'
import { log } from '@/server/logger'
import { targetTypes, type TargetCredentials } from '@/server/targets/pools'
import { quoteIdent, quoteLiteral } from '@/shared/sql/identifiers'

// Creates and destroys sandbox databases on the target server.
//
// The provisioner role has CREATEDB and CREATEROLE but is not a superuser.
// Each sandbox gets its own database and two login roles:
//
//   <db>_owner  owns the public schema; used for writes and migrations
//   <db>_ro     CONNECT + USAGE + SELECT only; used for every read
//
// CONNECT on the database is revoked from PUBLIC, so neither role can reach
// any other database on the server. Demo sandboxes are cloned from a
// template database whose objects belong to a NOLOGIN role; REASSIGN OWNED
// then hands them to the sandbox owner.

export type SandboxTemplate = 'empty' | 'ecommerce'

const TEMPLATE_DATABASE = 'df_template_ecommerce'
const TEMPLATE_OWNER = 'df_template_owner'
const TEMPLATE_LOCK = 4_215_022_102
const SANDBOX_NAME = /^df_[a-f0-9]{12}$/

export interface Sandbox {
    database: string
    owner: TargetCredentials
    reader: TargetCredentials
}

function provisionerCredentials(database: string): pg.ClientConfig {
    const env = config()
    return {
        host: env.TARGET_DB_HOST,
        port: env.TARGET_DB_PORT,
        database,
        user: env.TARGET_DB_PROVISIONER_USER,
        password: env.TARGET_DB_PROVISIONER_PASSWORD,
        connectionTimeoutMillis: 5_000,
        application_name: 'dataforge-provisioner',
        types: targetTypes,
    }
}

const globalForAdmin = globalThis as unknown as { __dataforgeAdminPool?: pg.Pool }

/** Pool on the provisioner's own maintenance database. */
export function adminPool(): pg.Pool {
    if (!globalForAdmin.__dataforgeAdminPool) {
        const pool = new pg.Pool({
            ...provisionerCredentials(config().TARGET_DB_ADMIN_DATABASE),
            max: 4,
            idleTimeoutMillis: 30_000,
        })
        pool.on('error', (error) => log.warn({ err: error }, 'provisioner pool error'))
        globalForAdmin.__dataforgeAdminPool = pool
    }
    return globalForAdmin.__dataforgeAdminPool
}

async function withDatabase<T>(
    database: string,
    work: (client: pg.Client) => Promise<T>,
): Promise<T> {
    const client = new pg.Client(provisionerCredentials(database))
    await client.connect()
    client.on('error', () => undefined)
    try {
        return await work(client)
    } finally {
        await client.end().catch(() => undefined)
    }
}

function managedCredentials(database: string, user: string, password: string): TargetCredentials {
    return {
        host: config().TARGET_DB_HOST,
        port: config().TARGET_DB_PORT,
        database,
        user,
        password,
        ssl: 'disable',
    }
}

/** Credentials for a managed sandbox, resolved against the current config. */
export function managedTarget(database: string, user: string, password: string) {
    return managedCredentials(database, user, password)
}

async function seedChecksum(): Promise<{ sql: string; checksum: string }> {
    const sql = await readFile(path.join(process.cwd(), 'db', 'demo', 'ecommerce.sql'), 'utf8')
    return { sql, checksum: createHash('sha256').update(sql).digest('hex').slice(0, 16) }
}

/**
 * Builds the demo template database if it is missing or its seed file has
 * changed. Safe to call from several app instances at once.
 */
export async function ensureDemoTemplate(): Promise<void> {
    const { sql, checksum } = await seedChecksum()
    const marker = `dataforge-template:ecommerce:${checksum}`
    const admin = await adminPool().connect()
    try {
        await admin.query('SELECT pg_advisory_lock($1)', [TEMPLATE_LOCK])
        const current = await admin.query<{ description: string | null }>(
            `SELECT shobj_description(oid, 'pg_database') AS description
             FROM pg_database WHERE datname = $1`,
            [TEMPLATE_DATABASE],
        )
        if (current.rows[0]?.description === marker) return

        log.info({ checksum }, 'building demo template database')
        const building = `${TEMPLATE_DATABASE}_build`
        const roleExists = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [
            TEMPLATE_OWNER,
        ])
        if (roleExists.rowCount === 0) await admin.query(`CREATE ROLE ${TEMPLATE_OWNER} NOLOGIN`)
        await admin.query(`DROP DATABASE IF EXISTS ${building} WITH (FORCE)`)
        await admin.query(`CREATE DATABASE ${building} TEMPLATE template0`)
        await admin.query(`REVOKE ALL ON DATABASE ${building} FROM PUBLIC`)
        await withDatabase(building, async (client) => {
            await client.query(`ALTER SCHEMA public OWNER TO ${TEMPLATE_OWNER}`)
            await client.query(`SET ROLE ${TEMPLATE_OWNER}`)
            await client.query(sql)
            await client.query('RESET ROLE')
        })
        await admin.query(`DROP DATABASE IF EXISTS ${TEMPLATE_DATABASE} WITH (FORCE)`)
        await admin.query(`ALTER DATABASE ${building} RENAME TO ${TEMPLATE_DATABASE}`)
        await admin.query(`COMMENT ON DATABASE ${TEMPLATE_DATABASE} IS ${quoteLiteral(marker)}`)
        log.info('demo template database ready')
    } finally {
        await admin.query('SELECT pg_advisory_unlock($1)', [TEMPLATE_LOCK]).catch(() => undefined)
        admin.release()
    }
}

function randomPassword(): string {
    return randomBytes(24).toString('base64url')
}

export async function managedDatabaseCount(): Promise<number> {
    const result = await adminPool().query<{ count: string }>(
        `SELECT count(*) FROM pg_database WHERE datname ~ '^df_[a-f0-9]{12}$'`,
    )
    return Number(result.rows[0]!.count)
}

export async function createSandbox(template: SandboxTemplate): Promise<Sandbox> {
    if ((await managedDatabaseCount()) >= config().SANDBOX_MAX_TOTAL) {
        throw new AppError(
            'capacity_reached',
            'This server has reached its limit of sandbox databases. Try again later.',
        )
    }
    if (template === 'ecommerce') await ensureDemoTemplate()

    const database = `df_${randomBytes(6).toString('hex')}`
    const owner = `${database}_owner`
    const reader = `${database}_ro`
    const ownerPassword = randomPassword()
    const readerPassword = randomPassword()
    const admin = adminPool()

    try {
        // Role passwords go in as literals (DDL takes no bind parameters).
        // They are generated base64url strings, and statement logging is off
        // on the target server.
        await admin.query(
            `CREATE ROLE ${owner} LOGIN PASSWORD ${quoteLiteral(ownerPassword)} CONNECTION LIMIT 8`,
        )
        await admin.query(
            `CREATE ROLE ${reader} LOGIN PASSWORD ${quoteLiteral(readerPassword)} CONNECTION LIMIT 8`,
        )
        const timeout = `${config().QUERY_TIMEOUT_MS}ms`
        for (const role of [owner, reader]) {
            await admin.query(`ALTER ROLE ${role} SET statement_timeout = ${quoteLiteral(timeout)}`)
            await admin.query(`ALTER ROLE ${role} SET lock_timeout = '5s'`)
            await admin.query(`ALTER ROLE ${role} SET idle_in_transaction_session_timeout = '60s'`)
        }
        await admin.query(`ALTER ROLE ${reader} SET default_transaction_read_only = on`)

        const source = template === 'ecommerce' ? TEMPLATE_DATABASE : 'template0'
        await admin.query(`CREATE DATABASE ${database} TEMPLATE ${source}`)
        await admin.query(`REVOKE ALL ON DATABASE ${database} FROM PUBLIC`)
        await admin.query(`GRANT CONNECT, TEMPORARY ON DATABASE ${database} TO ${owner}`)
        await admin.query(`GRANT CONNECT ON DATABASE ${database} TO ${reader}`)

        await withDatabase(database, async (client) => {
            if (template === 'ecommerce') {
                await client.query(`REASSIGN OWNED BY ${TEMPLATE_OWNER} TO ${owner}`)
            } else {
                await client.query(`ALTER SCHEMA public OWNER TO ${owner}`)
            }
            await client.query(`SET ROLE ${owner}`)
            await client.query(`REVOKE ALL ON SCHEMA public FROM PUBLIC`)
            await client.query(`GRANT USAGE ON SCHEMA public TO ${reader}`)
            await client.query(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${reader}`)
            await client.query(`GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO ${reader}`)
            await client.query(
                `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO ${reader}`,
            )
            await client.query(
                `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON SEQUENCES TO ${reader}`,
            )
            await client.query('RESET ROLE')
        })
    } catch (error) {
        log.error({ err: error, database }, 'sandbox provisioning failed; cleaning up')
        await dropSandbox(database).catch(() => undefined)
        throw new AppError(
            'target_unavailable',
            'Could not create the sandbox database. Try again.',
        )
    }

    return {
        database,
        owner: managedCredentials(database, owner, ownerPassword),
        reader: managedCredentials(database, reader, readerPassword),
    }
}

export async function dropSandbox(database: string): Promise<void> {
    if (!SANDBOX_NAME.test(database)) throw new Error(`Refusing to drop ${database}`)
    // WITH (FORCE) terminates open sessions, including idle pooled ones.
    const admin = adminPool()
    await admin.query(`DROP DATABASE IF EXISTS ${quoteIdent(database)} WITH (FORCE)`)
    await admin.query(`DROP ROLE IF EXISTS ${quoteIdent(`${database}_owner`)}`)
    await admin.query(`DROP ROLE IF EXISTS ${quoteIdent(`${database}_ro`)}`)
}

export async function sandboxSizeBytes(database: string): Promise<number> {
    const result = await adminPool().query<{ size: string }>(
        'SELECT pg_database_size($1) AS size',
        [database],
    )
    return Number(result.rows[0]!.size)
}

/** Cancels (or terminates) a running backend of a sandbox role. */
export async function signalBackend(pid: number, mode: 'cancel' | 'terminate'): Promise<boolean> {
    const fn = mode === 'cancel' ? 'pg_cancel_backend' : 'pg_terminate_backend'
    const result = await adminPool().query<{ ok: boolean }>(`SELECT ${fn}($1) AS ok`, [pid])
    return result.rows[0]?.ok ?? false
}

/** Sandbox databases that exist on the server, with their age. */
export async function listSandboxDatabases(): Promise<string[]> {
    const result = await adminPool().query<{ datname: string }>(
        `SELECT datname FROM pg_database WHERE datname ~ '^df_[a-f0-9]{12}$'`,
    )
    return result.rows.map((row) => row.datname)
}

export async function closeAdminPool() {
    const pool = globalForAdmin.__dataforgeAdminPool
    globalForAdmin.__dataforgeAdminPool = undefined
    await pool?.end()
}
