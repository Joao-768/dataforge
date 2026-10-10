import 'server-only'
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import type pg from 'pg'

// Forward-only SQL migrations for the application database. Each file in
// db/migrations runs once, inside its own transaction, and is recorded with a
// checksum so an edited migration is reported instead of silently skipped.
// An advisory lock keeps two app instances from migrating at the same time.

const LOCK_KEY = 4_215_022_101

export interface MigrationResult {
    applied: string[]
}

export async function migrateAppDatabase(
    pool: pg.Pool,
    directory = path.join(process.cwd(), 'db', 'migrations'),
): Promise<MigrationResult> {
    const files = (await readdir(directory)).filter((file) => file.endsWith('.sql')).sort()
    const client = await pool.connect()
    const applied: string[] = []
    try {
        await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY])
        await client.query(`
            CREATE TABLE IF NOT EXISTS schema_migrations (
                name text PRIMARY KEY,
                checksum text NOT NULL,
                applied_at timestamptz NOT NULL DEFAULT now()
            )
        `)
        const done = new Map(
            (
                await client.query<{ name: string; checksum: string }>(
                    'SELECT name, checksum FROM schema_migrations',
                )
            ).rows.map((row) => [row.name, row.checksum]),
        )
        for (const file of files) {
            const sql = await readFile(path.join(directory, file), 'utf8')
            const checksum = createHash('sha256').update(sql).digest('hex')
            const previous = done.get(file)
            if (previous) {
                if (previous !== checksum) {
                    throw new Error(
                        `Migration ${file} was edited after it was applied. Add a new migration instead.`,
                    )
                }
                continue
            }
            await client.query('BEGIN')
            try {
                await client.query(sql)
                await client.query(
                    'INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)',
                    [file, checksum],
                )
                await client.query('COMMIT')
                applied.push(file)
            } catch (error) {
                await client.query('ROLLBACK')
                throw new Error(`Migration ${file} failed: ${(error as Error).message}`)
            }
        }
        return { applied }
    } finally {
        await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => undefined)
        client.release()
    }
}
