import 'server-only'
import { z } from 'zod'
import { one, query } from '@/server/db/app-db'
import { notFound } from '@/server/errors'
import { requireProject } from '@/server/projects/service'

export const savedQuerySchema = z.object({
    name: z.string().trim().min(1, 'Name the query.').max(120),
    sql: z.string().min(1, 'The query is empty.').max(100_000),
})

interface SavedRow {
    id: string
    name: string
    sql: string
    created_at: Date
    updated_at: Date
}

const toSaved = (row: SavedRow) => ({
    id: row.id,
    name: row.name,
    sql: row.sql,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
})

export async function listSaved(userId: string, projectId: string) {
    await requireProject(userId, projectId)
    const result = await query<SavedRow>(
        `SELECT id, name, sql, created_at, updated_at FROM saved_queries
         WHERE project_id = $1 AND user_id = $2 ORDER BY updated_at DESC`,
        [projectId, userId],
    )
    return result.rows.map(toSaved)
}

export async function createSaved(
    userId: string,
    projectId: string,
    input: z.infer<typeof savedQuerySchema>,
) {
    await requireProject(userId, projectId)
    const row = await one<SavedRow>(
        `INSERT INTO saved_queries (project_id, user_id, name, sql) VALUES ($1, $2, $3, $4)
         RETURNING id, name, sql, created_at, updated_at`,
        [projectId, userId, input.name, input.sql],
    )
    return toSaved(row!)
}

export async function updateSaved(
    userId: string,
    projectId: string,
    id: string,
    input: z.infer<typeof savedQuerySchema>,
) {
    await requireProject(userId, projectId)
    const row = await one<SavedRow>(
        `UPDATE saved_queries SET name = $4, sql = $5, updated_at = now()
         WHERE id = $1 AND project_id = $2 AND user_id = $3
         RETURNING id, name, sql, created_at, updated_at`,
        [id, projectId, userId, input.name, input.sql],
    )
    if (!row) throw notFound('Saved query')
    return toSaved(row)
}

export async function deleteSaved(userId: string, projectId: string, id: string) {
    await requireProject(userId, projectId)
    const result = await query(
        'DELETE FROM saved_queries WHERE id = $1 AND project_id = $2 AND user_id = $3',
        [id, projectId, userId],
    )
    if (result.rowCount === 0) throw notFound('Saved query')
}
