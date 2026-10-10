import 'server-only'
import { query } from '@/server/db/app-db'
import { requireProject } from '@/server/projects/service'
import { withTargetTransaction } from '@/server/query/session'
import { projectTarget } from '@/server/targets/connections'

// Query analytics from two real sources: DataForge's own query history (what
// was run through the app, how long it took, how it ended) and PostgreSQL's
// statistics views for the target database. Nothing here is sampled or
// simulated; an empty history shows as empty.

export async function queryStats(userId: string, projectId: string, days = 14) {
    await requireProject(userId, projectId)
    const totals = await query<{
        total: string
        succeeded: string
        failed: string
        cancelled: string
        timed_out: string
        avg_ms: number | null
        p50_ms: number | null
        p95_ms: number | null
        max_ms: number | null
        rows: string | null
    }>(
        `SELECT count(*) AS total,
                count(*) FILTER (WHERE status = 'success') AS succeeded,
                count(*) FILTER (WHERE status = 'error') AS failed,
                count(*) FILTER (WHERE status = 'cancelled') AS cancelled,
                count(*) FILTER (WHERE status = 'timeout') AS timed_out,
                avg(duration_ms)::float8 AS avg_ms,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms)::float8 AS p50_ms,
                percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms)::float8 AS p95_ms,
                max(duration_ms)::float8 AS max_ms,
                sum(row_count)::text AS rows
         FROM query_history
         WHERE project_id = $1 AND created_at > now() - make_interval(days => $2)`,
        [projectId, days],
    )

    const daily = await query<{
        day: string
        total: string
        failed: string
        p95_ms: number | null
    }>(
        `SELECT to_char(day, 'YYYY-MM-DD') AS day,
                count(h.id) AS total,
                count(h.id) FILTER (WHERE h.status <> 'success') AS failed,
                percentile_cont(0.95) WITHIN GROUP (ORDER BY h.duration_ms)::float8 AS p95_ms
         FROM generate_series(
                  date_trunc('day', now()) - make_interval(days => $2 - 1),
                  date_trunc('day', now()),
                  interval '1 day'
              ) AS day
         LEFT JOIN query_history h
                ON h.project_id = $1 AND date_trunc('day', h.created_at) = day
         GROUP BY day
         ORDER BY day`,
        [projectId, days],
    )

    const slowest = await query<{
        id: string
        sql: string
        mode: string
        status: string
        duration_ms: number
        row_count: string | null
        source: string
        created_at: Date
    }>(
        `SELECT id::text, left(sql, 2000) AS sql, mode, status, duration_ms, row_count::text, source, created_at
         FROM query_history
         WHERE project_id = $1 AND created_at > now() - make_interval(days => $2)
         ORDER BY duration_ms DESC
         LIMIT 10`,
        [projectId, days],
    )

    const byMode = await query<{ mode: string; total: string; avg_ms: number }>(
        `SELECT mode, count(*) AS total, avg(duration_ms)::float8 AS avg_ms
         FROM query_history
         WHERE project_id = $1 AND created_at > now() - make_interval(days => $2)
         GROUP BY mode ORDER BY count(*) DESC`,
        [projectId, days],
    )

    const errors = await query<{ message: string; total: string; last_at: Date }>(
        `SELECT left(error_message, 300) AS message, count(*) AS total, max(created_at) AS last_at
         FROM query_history
         WHERE project_id = $1 AND status = 'error' AND created_at > now() - make_interval(days => $2)
         GROUP BY 1 ORDER BY count(*) DESC LIMIT 5`,
        [projectId, days],
    )

    const t = totals.rows[0]!
    return {
        days,
        totals: {
            total: Number(t.total),
            succeeded: Number(t.succeeded),
            failed: Number(t.failed),
            cancelled: Number(t.cancelled),
            timedOut: Number(t.timed_out),
            avgMs: t.avg_ms,
            p50Ms: t.p50_ms,
            p95Ms: t.p95_ms,
            maxMs: t.max_ms,
            rows: t.rows === null ? 0 : Number(t.rows),
        },
        daily: daily.rows.map((row) => ({
            day: row.day,
            total: Number(row.total),
            failed: Number(row.failed),
            p95Ms: row.p95_ms,
        })),
        slowest: slowest.rows.map((row) => ({
            id: row.id,
            sql: row.sql,
            mode: row.mode,
            status: row.status,
            durationMs: row.duration_ms,
            rowCount: row.row_count === null ? null : Number(row.row_count),
            source: row.source,
            createdAt: row.created_at.toISOString(),
        })),
        byMode: byMode.rows.map((row) => ({
            mode: row.mode,
            total: Number(row.total),
            avgMs: row.avg_ms,
        })),
        topErrors: errors.rows.map((row) => ({
            message: row.message,
            total: Number(row.total),
            lastAt: row.last_at.toISOString(),
        })),
    }
}

export async function engineStats(userId: string, projectId: string) {
    const target = await projectTarget(userId, projectId, 'read')
    return withTargetTransaction(target, userId, 'read', async (ctx) => {
        const database = await ctx.client.query<{
            size: string
            blks_hit: string
            blks_read: string
            xact_commit: string
            xact_rollback: string
            deadlocks: string
            stats_reset: Date | null
            backends: number
        }>(
            `SELECT pg_database_size(current_database())::text AS size,
                    blks_hit::text, blks_read::text, xact_commit::text, xact_rollback::text,
                    deadlocks::text, stats_reset, numbackends AS backends
             FROM pg_stat_database WHERE datname = current_database()`,
        )
        const tables = await ctx.client.query<{
            schema: string
            name: string
            total_bytes: string
            live: string
            dead: string
            seq_scan: string
            idx_scan: string | null
            last_analyze: Date | null
            last_autoanalyze: Date | null
        }>(
            `SELECT s.schemaname AS schema, s.relname AS name,
                    pg_total_relation_size(s.relid)::text AS total_bytes,
                    s.n_live_tup::text AS live, s.n_dead_tup::text AS dead,
                    s.seq_scan::text, s.idx_scan::text,
                    s.last_analyze, s.last_autoanalyze
             FROM pg_stat_user_tables s
             ORDER BY pg_total_relation_size(s.relid) DESC
             LIMIT 50`,
        )
        const indexes = await ctx.client.query<{
            schema: string
            table: string
            name: string
            scans: string
            bytes: string
        }>(
            `SELECT schemaname AS schema, relname AS table, indexrelname AS name,
                    idx_scan::text AS scans, pg_relation_size(indexrelid)::text AS bytes
             FROM pg_stat_user_indexes
             ORDER BY idx_scan ASC, pg_relation_size(indexrelid) DESC
             LIMIT 50`,
        )
        const statements = await ctx.client.query<{ installed: boolean }>(
            `SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements') AS installed`,
        )
        const version = await ctx.client.query<{ version: string }>(
            `SELECT current_setting('server_version') AS version`,
        )
        const db = database.rows[0]!
        const hits = Number(db.blks_hit)
        const reads = Number(db.blks_read)
        return {
            serverVersion: version.rows[0]!.version,
            database: {
                sizeBytes: Number(db.size),
                cacheHitRatio: hits + reads === 0 ? null : hits / (hits + reads),
                commits: Number(db.xact_commit),
                rollbacks: Number(db.xact_rollback),
                deadlocks: Number(db.deadlocks),
                backends: db.backends,
                statsSince: db.stats_reset?.toISOString() ?? null,
            },
            tables: tables.rows.map((row) => ({
                schema: row.schema,
                name: row.name,
                totalBytes: Number(row.total_bytes),
                liveRows: Number(row.live),
                deadRows: Number(row.dead),
                seqScans: Number(row.seq_scan),
                indexScans: row.idx_scan === null ? null : Number(row.idx_scan),
                lastAnalyzed: (row.last_analyze ?? row.last_autoanalyze)?.toISOString() ?? null,
            })),
            indexes: indexes.rows.map((row) => ({
                schema: row.schema,
                table: row.table,
                name: row.name,
                scans: Number(row.scans),
                bytes: Number(row.bytes),
            })),
            pgStatStatements: statements.rows[0]!.installed,
        }
    })
}
