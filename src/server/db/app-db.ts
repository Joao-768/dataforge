import 'server-only'
import pg from 'pg'
import { config } from '@/server/config'
import { log } from '@/server/logger'

// Connection pool for DataForge's own application database. Target databases
// never go through this pool (see src/server/targets/pools.ts).

export type Queryable = Pick<pg.PoolClient, 'query'>

const globalForPool = globalThis as unknown as { __dataforgeAppPool?: pg.Pool }

export function appPool(): pg.Pool {
    // Reuse one pool across hot reloads in development.
    if (!globalForPool.__dataforgeAppPool) {
        const pool = new pg.Pool({
            connectionString: config().DATABASE_URL,
            max: config().APP_DB_POOL_MAX,
            idleTimeoutMillis: 30_000,
            connectionTimeoutMillis: 5_000,
            statement_timeout: 30_000,
            application_name: 'dataforge-app',
        })
        pool.on('error', (error) => log.error({ err: error }, 'app database pool error'))
        globalForPool.__dataforgeAppPool = pool
    }
    return globalForPool.__dataforgeAppPool
}

export async function query<Row extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values: unknown[] = [],
): Promise<pg.QueryResult<Row>> {
    return appPool().query<Row>(text, values)
}

export async function one<Row extends pg.QueryResultRow>(
    text: string,
    values: unknown[] = [],
): Promise<Row | null> {
    const result = await query<Row>(text, values)
    return result.rows[0] ?? null
}

/** Runs `work` in a transaction, rolling back if it throws. */
export async function transaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await appPool().connect()
    try {
        await client.query('BEGIN')
        const result = await work(client)
        await client.query('COMMIT')
        return result
    } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined)
        throw error
    } finally {
        client.release()
    }
}

export async function closeAppPool() {
    const pool = globalForPool.__dataforgeAppPool
    globalForPool.__dataforgeAppPool = undefined
    await pool?.end()
}
