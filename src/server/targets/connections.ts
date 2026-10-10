import 'server-only'
import { randomUUID } from 'node:crypto'
import type pg from 'pg'
import { z } from 'zod'
import { recordActivity } from '@/server/activity'
import { config } from '@/server/config'
import { one, query } from '@/server/db/app-db'
import { AppError } from '@/server/errors'
import { log } from '@/server/logger'
import { requireProject } from '@/server/projects/service'
import { decryptSecret, encryptSecret } from '@/server/security/crypto'
import { introspect } from '@/server/schema/introspect'
import { resolveExternalHost } from '@/server/targets/network-guard'
import {
    closeTargetPools,
    connectOnce,
    targetPool,
    type TargetCredentials,
} from '@/server/targets/pools'
import {
    createSandbox,
    dropSandbox,
    managedTarget,
    sandboxSizeBytes,
    type SandboxTemplate,
} from '@/server/targets/provisioner'

// One target database per project. This module is the only place that
// decrypts credentials, and it hands out pools, never passwords: nothing it
// returns to a route handler contains a secret.

export type Role = 'read' | 'write'

interface ConnectionRow {
    id: string
    project_id: string
    kind: 'managed' | 'external'
    status: 'provisioning' | 'ready' | 'error'
    host: string
    port: number
    database_name: string
    ssl_mode: 'disable' | 'require' | 'verify-full'
    read_user: string
    read_password_enc: string
    write_user: string | null
    write_password_enc: string | null
    template: string | null
    server_version: string | null
    table_count: number | null
    last_checked_at: Date | null
    last_error: string | null
    created_at: Date
}

export interface ConnectionInfo {
    id: string
    kind: 'managed' | 'external'
    status: 'provisioning' | 'ready' | 'error'
    host: string
    port: number
    database: string
    sslMode: string
    readUser: string
    writeUser: string | null
    canWrite: boolean
    template: string | null
    serverVersion: string | null
    tableCount: number | null
    lastCheckedAt: string | null
    lastError: string | null
    createdAt: string
}

function toInfo(row: ConnectionRow): ConnectionInfo {
    return {
        id: row.id,
        kind: row.kind,
        status: row.status,
        // The managed server's address is an internal detail.
        host: row.kind === 'managed' ? 'DataForge sandbox server' : row.host,
        port: row.port,
        database: row.database_name,
        sslMode: row.ssl_mode,
        readUser: row.read_user,
        writeUser: row.write_user,
        canWrite: row.write_user !== null,
        template: row.template,
        serverVersion: row.server_version,
        tableCount: row.table_count,
        lastCheckedAt: row.last_checked_at?.toISOString() ?? null,
        lastError: row.last_error,
        createdAt: row.created_at.toISOString(),
    }
}

async function connectionRow(projectId: string): Promise<ConnectionRow | null> {
    return one<ConnectionRow>('SELECT * FROM connections WHERE project_id = $1', [projectId])
}

export async function getConnection(
    userId: string,
    projectId: string,
): Promise<ConnectionInfo | null> {
    await requireProject(userId, projectId)
    const row = await connectionRow(projectId)
    return row ? toInfo(row) : null
}

/** Resolved target for one role, ready to open connections. */
export interface Target {
    connection: ConnectionInfo
    role: Role
    credentials: TargetCredentials
    pool: pg.Pool
    poolKey: string
}

async function credentialsFor(row: ConnectionRow, role: Role): Promise<TargetCredentials> {
    const user = role === 'write' ? row.write_user : row.read_user
    const encrypted = role === 'write' ? row.write_password_enc : row.read_password_enc
    if (!user || !encrypted) {
        throw new AppError(
            'forbidden',
            'This connection is read-only. Add credentials with write access in project settings to make changes.',
        )
    }
    const password = decryptSecret(encrypted, row.id)
    if (row.kind === 'managed') return managedTarget(row.database_name, user, password)
    // External hosts are re-checked on every use, and the connection is made
    // to the checked address.
    const resolved = await resolveExternalHost(row.host)
    return {
        host: resolved.address,
        servername: resolved.servername,
        port: row.port,
        database: row.database_name,
        user,
        password,
        ssl: row.ssl_mode,
    }
}

/**
 * The target database of a project the user owns. Throws 404 for projects of
 * other users, 409 when the project has no database yet.
 */
export async function projectTarget(
    userId: string,
    projectId: string,
    role: Role,
): Promise<Target> {
    await requireProject(userId, projectId)
    const row = await connectionRow(projectId)
    if (!row) throw new AppError('conflict', 'This project has no database yet.')
    if (row.status === 'provisioning')
        throw new AppError('conflict', 'The database is still being created.')
    const credentials = await credentialsFor(row, role)
    const poolKey = `${row.id}:${role}`
    return {
        connection: toInfo(row),
        role,
        credentials,
        pool: targetPool(poolKey, credentials),
        poolKey,
    }
}

/** Refuses writes once a managed sandbox has grown past its size limit. */
export async function assertWithinQuota(target: Target) {
    if (target.connection.kind !== 'managed') return
    const size = await sandboxSizeBytes(target.connection.database)
    const limit = config().SANDBOX_MAX_SIZE_MB * 1024 * 1024
    if (size > limit) {
        throw new AppError(
            'capacity_reached',
            `This sandbox uses ${Math.round(size / 1024 / 1024)} MB, over its ${config().SANDBOX_MAX_SIZE_MB} MB limit. Writes are paused; delete data with a smaller import or recreate the database.`,
        )
    }
}

export async function provisionManaged(
    userId: string,
    projectId: string,
    template: SandboxTemplate,
    { isGuest }: { isGuest: boolean },
): Promise<ConnectionInfo> {
    await requireProject(userId, projectId)
    if (await connectionRow(projectId)) {
        throw new AppError('conflict', 'This project already has a database.')
    }
    const owned = await one<{ count: string }>(
        `SELECT count(*) FROM connections c JOIN projects p ON p.id = c.project_id
         WHERE p.owner_id = $1 AND c.kind = 'managed'`,
        [userId],
    )
    const limit = isGuest ? 1 : config().SANDBOX_MAX_PER_USER
    if (Number(owned!.count) >= limit) {
        throw new AppError(
            'capacity_reached',
            `You can have up to ${limit} sandbox database${limit === 1 ? '' : 's'}. Remove one from another project first.`,
        )
    }

    const sandbox = await createSandbox(template)
    const id = randomUUID()
    try {
        await query(
            `INSERT INTO connections
                (id, project_id, kind, status, host, port, database_name, ssl_mode,
                 read_user, read_password_enc, write_user, write_password_enc, template)
             VALUES ($1, $2, 'managed', 'ready', 'managed', $3, $4, 'disable', $5, $6, $7, $8, $9)`,
            [
                id,
                projectId,
                sandbox.reader.port,
                sandbox.database,
                sandbox.reader.user,
                encryptSecret(sandbox.reader.password, id),
                sandbox.owner.user,
                encryptSecret(sandbox.owner.password, id),
                template,
            ],
        )
    } catch (error) {
        await dropSandbox(sandbox.database).catch(() => undefined)
        if ((error as { code?: string }).code === '23505') {
            throw new AppError('conflict', 'This project already has a database.')
        }
        throw error
    }
    await recordActivity({
        userId,
        projectId,
        kind: 'database.provisioned',
        message:
            template === 'ecommerce'
                ? 'Created a sandbox database with the e-commerce sample'
                : 'Created an empty sandbox database',
    })
    await checkConnection(userId, projectId)
    return toInfo((await connectionRow(projectId))!)
}

export const externalConnectionSchema = z.object({
    host: z.string().trim().min(1, 'Enter a host.').max(253),
    port: z.coerce.number().int().min(1).max(65535).default(5432),
    database: z.string().trim().min(1, 'Enter a database name.').max(63),
    sslMode: z.enum(['disable', 'require', 'verify-full']).default('verify-full'),
    readUser: z.string().trim().min(1, 'Enter a user.').max(63),
    readPassword: z.string().min(1, 'Enter a password.').max(500),
    writeUser: z.string().trim().max(63).optional(),
    writePassword: z.string().max(500).optional(),
})

async function probe(credentials: TargetCredentials) {
    let client: pg.Client | undefined
    try {
        client = await connectOnce(credentials)
        const result = await client.query<{ version: string; readonly: string }>(
            `SELECT current_setting('server_version') AS version,
                    current_setting('default_transaction_read_only') AS readonly`,
        )
        return result.rows[0]!
    } catch (error) {
        const message = (error as Error).message
        throw new AppError('target_unavailable', `Could not connect: ${message}`)
    } finally {
        await client?.end().catch(() => undefined)
    }
}

export async function addExternal(
    userId: string,
    projectId: string,
    input: z.infer<typeof externalConnectionSchema>,
): Promise<ConnectionInfo> {
    await requireProject(userId, projectId)
    if (await connectionRow(projectId))
        throw new AppError('conflict', 'This project already has a database.')
    const resolved = await resolveExternalHost(input.host)
    const base = {
        host: resolved.address,
        servername: resolved.servername,
        port: input.port,
        database: input.database,
        ssl: input.sslMode,
    } as const
    const info = await probe({ ...base, user: input.readUser, password: input.readPassword })
    const hasWrite = Boolean(input.writeUser && input.writePassword)
    if (hasWrite) await probe({ ...base, user: input.writeUser!, password: input.writePassword! })

    const id = randomUUID()
    await query(
        `INSERT INTO connections
            (id, project_id, kind, status, host, port, database_name, ssl_mode, read_user,
             read_password_enc, write_user, write_password_enc, server_version, last_checked_at)
         VALUES ($1, $2, 'external', 'ready', $3, $4, $5, $6, $7, $8, $9, $10, $11, now())`,
        [
            id,
            projectId,
            input.host.trim().toLowerCase(),
            input.port,
            input.database,
            input.sslMode,
            input.readUser,
            encryptSecret(input.readPassword, id),
            hasWrite ? input.writeUser : null,
            hasWrite ? encryptSecret(input.writePassword!, id) : null,
            info.version,
        ],
    )
    await recordActivity({
        userId,
        projectId,
        kind: 'database.connected',
        message: `Connected to ${input.database} on ${input.host}`,
    })
    await checkConnection(userId, projectId)
    return toInfo((await connectionRow(projectId))!)
}

/** Connects with the read role, refreshes version and table count, records errors. */
export async function checkConnection(userId: string, projectId: string): Promise<ConnectionInfo> {
    await requireProject(userId, projectId)
    const row = await connectionRow(projectId)
    if (!row) throw new AppError('conflict', 'This project has no database yet.')
    try {
        const target = await projectTarget(userId, projectId, 'read')
        const client = await target.pool.connect()
        try {
            const version = await client.query<{ version: string }>(
                `SELECT current_setting('server_version') AS version`,
            )
            const schema = await introspect(client)
            await query(
                `UPDATE connections
                 SET status = 'ready', server_version = $2, table_count = $3,
                     last_checked_at = now(), last_error = NULL
                 WHERE id = $1`,
                [row.id, version.rows[0]!.version, schema.tables.length],
            )
        } finally {
            client.release()
        }
    } catch (error) {
        const message = error instanceof AppError ? error.message : (error as Error).message
        await query(
            `UPDATE connections SET status = 'error', last_checked_at = now(), last_error = $2 WHERE id = $1`,
            [row.id, message.slice(0, 500)],
        )
        log.warn({ projectId, err: error }, 'connection check failed')
    }
    return toInfo((await connectionRow(projectId))!)
}

/** Updates the cached table count after a schema change. */
export async function rememberTableCount(projectId: string, count: number) {
    await query(
        'UPDATE connections SET table_count = $2, last_checked_at = now() WHERE project_id = $1',
        [projectId, count],
    )
}

export async function removeConnection(
    userId: string,
    projectId: string,
    { quiet = false }: { quiet?: boolean } = {},
) {
    await requireProject(userId, projectId)
    const row = await connectionRow(projectId)
    if (!row) return
    await closeTargetPools(row.id)
    if (row.kind === 'managed') await dropSandbox(row.database_name)
    await query('DELETE FROM connections WHERE id = $1', [row.id])
    // The draft describes a database that is gone.
    await query('DELETE FROM schema_drafts WHERE project_id = $1', [projectId])
    if (!quiet) {
        await recordActivity({
            userId,
            projectId,
            kind: 'database.removed',
            message:
                row.kind === 'managed'
                    ? 'Deleted the sandbox database'
                    : 'Disconnected the external database',
        })
    }
}

export function externalConnectionsEnabled(): boolean {
    return config().EXTERNAL_CONNECTIONS === 'allowlist'
}
