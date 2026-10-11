import 'server-only'
import pg from 'pg'
import { config } from '@/server/config'
import { log } from '@/server/logger'

// Pools for target databases, one per (connection, role). They are small and
// short-lived: a sandbox role has a connection limit of a handful, and pools
// close themselves after a minute without use.

export interface TargetCredentials {
    host: string
    port: number
    database: string
    user: string
    password: string
    ssl: 'disable' | 'require' | 'verify-full'
    /** TLS server name when `host` is a pinned IP address. */
    servername?: string
}

// Types that JavaScript would distort are kept as the text PostgreSQL sent:
// 64-bit integers and numerics (precision), dates and timestamps (time zone
// handling), intervals and money.
const KEEP_AS_TEXT = new Set([20, 790, 1082, 1083, 1114, 1184, 1186, 1266, 1700])

export const targetTypes: pg.CustomTypesConfig = {
    getTypeParser: ((oid: number, format?: string) => {
        if (KEEP_AS_TEXT.has(oid)) return (value: string) => value
        // bytea stays in PostgreSQL's hex text form ("\x...").
        if (oid === 17) return (value: string) => value
        return pg.types.getTypeParser(oid, (format ?? 'text') as 'text')
    }) as pg.CustomTypesConfig['getTypeParser'],
}

const MAX_POOLS = 60
const pools = new Map<string, { pool: pg.Pool; lastUsed: number }>()

export function sslOption(
    credentials: Pick<TargetCredentials, 'ssl' | 'servername'>,
): pg.PoolConfig['ssl'] {
    if (credentials.ssl === 'disable') return false
    return {
        rejectUnauthorized: credentials.ssl === 'verify-full',
        servername: credentials.servername,
    }
}

export function targetPool(key: string, credentials: TargetCredentials, maxClients = 3): pg.Pool {
    const existing = pools.get(key)
    if (existing) {
        existing.lastUsed = Date.now()
        return existing.pool
    }
    if (pools.size >= MAX_POOLS) evictOldest()
    const pool = new pg.Pool({
        host: credentials.host,
        port: credentials.port,
        database: credentials.database,
        user: credentials.user,
        password: credentials.password,
        ssl: sslOption(credentials),
        max: maxClients,
        idleTimeoutMillis: 60_000,
        connectionTimeoutMillis: 5_000,
        application_name: 'dataforge',
        types: targetTypes,
        // Session defaults; the executor also enforces a wall-clock limit.
        options: [
            `-c statement_timeout=${config().QUERY_TIMEOUT_MS}`,
            '-c lock_timeout=5000',
            '-c idle_in_transaction_session_timeout=60000',
        ].join(' '),
    })
    pool.on('error', (error) => log.warn({ err: error, pool: key }, 'target pool client error'))
    pools.set(key, { pool, lastUsed: Date.now() })
    return pool
}

function evictOldest() {
    let oldestKey: string | undefined
    let oldest = Infinity
    for (const [key, entry] of pools) {
        if (entry.lastUsed < oldest) {
            oldest = entry.lastUsed
            oldestKey = key
        }
    }
    if (oldestKey) void closeTargetPool(oldestKey)
}

export async function closeTargetPool(key: string) {
    const entry = pools.get(key)
    pools.delete(key)
    await entry?.pool.end().catch(() => undefined)
}

/** Closes every pool whose key starts with `prefix` (all roles of a connection). */
export async function closeTargetPools(prefix: string) {
    await Promise.all(
        [...pools.keys()].filter((key) => key.startsWith(prefix)).map(closeTargetPool),
    )
}

/** A one-off client, for connection tests and cancel requests. */
export async function connectOnce(credentials: TargetCredentials): Promise<pg.Client> {
    const client = new pg.Client({
        host: credentials.host,
        port: credentials.port,
        database: credentials.database,
        user: credentials.user,
        password: credentials.password,
        ssl: sslOption(credentials),
        connectionTimeoutMillis: 5_000,
        application_name: 'dataforge',
        types: targetTypes,
        options: '-c statement_timeout=10000',
    })
    await client.connect()
    client.on('error', () => undefined)
    return client
}
