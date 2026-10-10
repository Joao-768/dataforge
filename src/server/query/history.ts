import 'server-only'
import { query } from '@/server/db/app-db'

// Query history keeps what was run, how long it took and how it ended.
// Result rows are never stored.

export interface HistoryEntry {
    projectId: string
    userId: string
    sql: string
    mode: 'read' | 'write' | 'explain' | 'explain_analyze'
    status: 'success' | 'error' | 'cancelled' | 'timeout'
    statementCount: number
    rowCount: number | null
    durationMs: number
    errorCode?: string | null
    errorMessage?: string | null
    source?: 'editor' | 'explorer' | 'import' | 'export'
}

export async function recordQuery(entry: HistoryEntry) {
    await query(
        `INSERT INTO query_history
            (project_id, user_id, sql, mode, status, statement_count, row_count, duration_ms,
             error_code, error_message, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
            entry.projectId,
            entry.userId,
            entry.sql.slice(0, 20_000),
            entry.mode,
            entry.status,
            entry.statementCount,
            entry.rowCount,
            Math.round(entry.durationMs),
            entry.errorCode ?? null,
            entry.errorMessage?.slice(0, 1000) ?? null,
            entry.source ?? 'editor',
        ],
    )
}

export async function listHistory(projectId: string, userId: string, limit = 50, before?: number) {
    const result = await query<{
        id: string
        sql: string
        mode: string
        status: string
        statement_count: number
        row_count: string | null
        duration_ms: number
        error_message: string | null
        source: string
        created_at: Date
    }>(
        `SELECT id::text, sql, mode, status, statement_count, row_count::text, duration_ms,
                error_message, source, created_at
         FROM query_history
         WHERE project_id = $1 AND user_id = $2 AND ($4::bigint IS NULL OR query_history.id < $4)
         -- Order by the bigint column, not the text alias selected above.
         ORDER BY query_history.id DESC
         LIMIT $3`,
        [projectId, userId, limit, before ?? null],
    )
    return result.rows.map((row) => ({
        id: row.id,
        sql: row.sql,
        mode: row.mode,
        status: row.status,
        statementCount: row.statement_count,
        rowCount: row.row_count === null ? null : Number(row.row_count),
        durationMs: row.duration_ms,
        errorMessage: row.error_message,
        source: row.source,
        createdAt: row.created_at.toISOString(),
    }))
}
