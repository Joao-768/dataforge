import 'server-only'
import type { z } from 'zod'
import { recordActivity } from '@/server/activity'
import { one, query } from '@/server/db/app-db'
import { AppError, notFound } from '@/server/errors'
import { log } from '@/server/logger'
import { removeConnection } from '@/server/targets/connections'
import type { projectSchema, projectUpdateSchema } from '@/shared/validation'

// Projects are the unit of ownership: every connection, draft, migration,
// saved query and history row hangs off a project, and every project-scoped
// request starts with requireProject(), which returns 404 (not 403) for
// projects the user does not own, so ids cannot be probed.

export interface ProjectRow {
    id: string
    owner_id: string
    name: string
    description: string
    created_at: Date
    updated_at: Date
    schema_changed_at: Date | null
}

export interface ProjectSummary {
    id: string
    name: string
    description: string
    createdAt: string
    updatedAt: string
    schemaChangedAt: string | null
    database: {
        kind: 'managed' | 'external'
        status: 'provisioning' | 'ready' | 'error'
        tableCount: number | null
        template: string | null
        lastError: string | null
    } | null
    lastActivityAt: string | null
}

export async function requireProject(userId: string, projectId: string): Promise<ProjectRow> {
    if (!/^[0-9a-f-]{36}$/i.test(projectId)) throw notFound('Project')
    const project = await one<ProjectRow>(
        'SELECT * FROM projects WHERE id = $1 AND owner_id = $2',
        [projectId, userId],
    )
    if (!project) throw notFound('Project')
    return project
}

function isUniqueViolation(error: unknown) {
    return (error as { code?: string }).code === '23505'
}

export async function listProjects(userId: string): Promise<ProjectSummary[]> {
    const result = await query<{
        id: string
        name: string
        description: string
        created_at: Date
        updated_at: Date
        schema_changed_at: Date | null
        kind: 'managed' | 'external' | null
        status: 'provisioning' | 'ready' | 'error' | null
        table_count: number | null
        template: string | null
        last_error: string | null
        last_activity_at: Date | null
    }>(
        `SELECT p.id, p.name, p.description, p.created_at, p.updated_at, p.schema_changed_at,
                c.kind, c.status, c.table_count, c.template, c.last_error,
                (SELECT max(a.created_at) FROM activity a WHERE a.project_id = p.id) AS last_activity_at
         FROM projects p
         LEFT JOIN connections c ON c.project_id = p.id
         WHERE p.owner_id = $1
         ORDER BY p.updated_at DESC`,
        [userId],
    )
    return result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
        schemaChangedAt: row.schema_changed_at?.toISOString() ?? null,
        database: row.kind
            ? {
                  kind: row.kind,
                  status: row.status!,
                  tableCount: row.table_count,
                  template: row.template,
                  lastError: row.last_error,
              }
            : null,
        lastActivityAt: row.last_activity_at?.toISOString() ?? null,
    }))
}

export async function getProjectSummary(
    userId: string,
    projectId: string,
): Promise<ProjectSummary> {
    await requireProject(userId, projectId)
    const summary = (await listProjects(userId)).find((project) => project.id === projectId)
    if (!summary) throw notFound('Project')
    return summary
}

export async function createProject(userId: string, input: z.infer<typeof projectSchema>) {
    const count = await one<{ count: string }>(
        'SELECT count(*) FROM projects WHERE owner_id = $1',
        [userId],
    )
    if (Number(count!.count) >= 25) {
        throw new AppError(
            'capacity_reached',
            'You can have up to 25 projects. Delete one to create another.',
        )
    }
    try {
        const project = await one<{ id: string }>(
            `INSERT INTO projects (owner_id, name, description) VALUES ($1, $2, $3) RETURNING id`,
            [userId, input.name, input.description],
        )
        await recordActivity({
            userId,
            projectId: project!.id,
            kind: 'project.created',
            message: `Created project ${input.name}`,
        })
        return project!
    } catch (error) {
        if (isUniqueViolation(error))
            throw new AppError('conflict', 'You already have a project with this name.')
        throw error
    }
}

export async function updateProject(
    userId: string,
    projectId: string,
    input: z.infer<typeof projectUpdateSchema>,
) {
    const project = await requireProject(userId, projectId)
    try {
        await query(
            `UPDATE projects SET name = $2, description = $3, updated_at = now() WHERE id = $1`,
            [projectId, input.name ?? project.name, input.description ?? project.description],
        )
    } catch (error) {
        if (isUniqueViolation(error))
            throw new AppError('conflict', 'You already have a project with this name.')
        throw error
    }
    if (input.name && input.name !== project.name) {
        await recordActivity({
            userId,
            projectId,
            kind: 'project.renamed',
            message: `Renamed ${project.name} to ${input.name}`,
        })
    }
}

export async function deleteProject(userId: string, projectId: string) {
    await requireProject(userId, projectId)
    // The managed database goes first: if dropping it fails, the project
    // stays so the user can retry instead of leaving an orphaned database.
    await removeConnection(userId, projectId, { quiet: true })
    await query('DELETE FROM projects WHERE id = $1 AND owner_id = $2', [projectId, userId])
}

export async function deleteAllProjectsOf(userId: string) {
    const projects = await query<{ id: string }>('SELECT id FROM projects WHERE owner_id = $1', [
        userId,
    ])
    for (const project of projects.rows) {
        try {
            await deleteProject(userId, project.id)
        } catch (error) {
            log.error({ err: error, projectId: project.id }, 'could not delete project')
            throw error
        }
    }
}

export async function recentActivity(userId: string, projectId?: string, limit = 20) {
    const result = await query<{
        id: string
        project_id: string | null
        project_name: string | null
        kind: string
        message: string
        created_at: Date
    }>(
        `SELECT a.id::text, a.project_id, p.name AS project_name, a.kind, a.message, a.created_at
         FROM activity a
         LEFT JOIN projects p ON p.id = a.project_id
         WHERE a.user_id = $1 AND ($2::uuid IS NULL OR a.project_id = $2)
         ORDER BY a.created_at DESC
         LIMIT $3`,
        [userId, projectId ?? null, limit],
    )
    return result.rows.map((row) => ({
        id: row.id,
        projectId: row.project_id,
        projectName: row.project_name,
        kind: row.kind,
        message: row.message,
        createdAt: row.created_at.toISOString(),
    }))
}
