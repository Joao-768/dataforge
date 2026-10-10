import 'server-only'
import { z } from 'zod'
import { recordActivity } from '@/server/activity'
import { one, query } from '@/server/db/app-db'
import { AppError, notFound } from '@/server/errors'
import { log } from '@/server/logger'
import { requireProject } from '@/server/projects/service'
import { invalidateSchema, liveSchema } from '@/server/schema/cache'
import { fingerprint } from '@/server/schema/introspect'
import { projectTarget, rememberTableCount, type Target } from '@/server/targets/connections'
import {
    diffSchemas,
    hasDestructiveSteps,
    migrationScript,
    type MigrationStep,
} from '@/shared/schema/diff'
import {
    draftDocumentSchema,
    tableKey,
    type DraftDocument,
    type LiveSchema,
    type Position,
    type SchemaTable,
} from '@/shared/schema/model'
import { hasErrors, validateTables, type SchemaIssue } from '@/shared/schema/validate'
import { splitStatements } from '@/shared/sql/split'

// Schema drafts and migrations.
//
// A project's draft is the designer's working copy of the schema. It records
// the live schema it was based on, so the server can tell (a) whether the
// draft has unapplied changes, by diffing it against that base, and (b)
// whether the database changed underneath it, by comparing fingerprints.
//
// A migration freezes the diff into statements. Applying it re-checks the
// fingerprint, runs every statement in one transaction, and records the
// outcome only from what PostgreSQL reports: "applied" after COMMIT
// succeeds, "failed" after a rollback. If the app dies mid-apply, the
// transaction id recorded beforehand lets pg_xact_status() settle the
// outcome later instead of guessing.

interface DraftRow {
    document: DraftDocument
    base_document: { tables: SchemaTable[] }
    base_fingerprint: string
    revision: number
    updated_at: Date
}

export interface DraftState {
    document: DraftDocument
    /** The live schema the draft is based on, for marking pending changes. */
    base: SchemaTable[]
    revision: number
    updatedAt: string
    /** The database changed since the draft was based on it. */
    stale: boolean
    /** The draft differs from the schema it was based on. */
    dirty: boolean
    issues: SchemaIssue[]
    views: LiveSchema['views']
    schemas: string[]
}

function mergePositions(
    tables: SchemaTable[],
    previous: DraftDocument | null,
): Record<string, Position> {
    if (!previous) return {}
    const byKey = new Map(
        previous.tables.map((table) => [tableKey(table), previous.positions[table.id]]),
    )
    const positions: Record<string, Position> = {}
    for (const table of tables) {
        const position = previous.positions[table.id] ?? byKey.get(tableKey(table))
        if (position) positions[table.id] = position
    }
    return positions
}

async function writeDraft(
    projectId: string,
    userId: string,
    document: DraftDocument,
    base: SchemaTable[],
) {
    await query(
        `INSERT INTO schema_drafts (project_id, document, base_document, base_fingerprint, updated_by)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (project_id) DO UPDATE SET
             document = EXCLUDED.document,
             base_document = EXCLUDED.base_document,
             base_fingerprint = EXCLUDED.base_fingerprint,
             revision = schema_drafts.revision + 1,
             updated_by = EXCLUDED.updated_by,
             updated_at = now()`,
        [
            projectId,
            JSON.stringify(document),
            JSON.stringify({ tables: base }),
            fingerprint(base),
            userId,
        ],
    )
}

async function rebaseOnLive(
    projectId: string,
    userId: string,
    live: LiveSchema,
    previous: DraftDocument | null,
) {
    const document: DraftDocument = {
        version: 1,
        tables: live.tables,
        positions: mergePositions(live.tables, previous),
    }
    await writeDraft(projectId, userId, document, live.tables)
    await rememberTableCount(projectId, live.tables.length)
}

export async function getDraft(userId: string, projectId: string): Promise<DraftState> {
    const target = await projectTarget(userId, projectId, 'read')
    const live = await liveSchema(target, { fresh: true })
    const liveFingerprint = fingerprint(live.tables)
    let row = await one<DraftRow>('SELECT * FROM schema_drafts WHERE project_id = $1', [projectId])

    const isDirty = (draft: DraftRow) =>
        diffSchemas(draft.base_document.tables, draft.document.tables).steps.length > 0

    // No draft yet, or an untouched draft whose database moved on (e.g. a
    // table created in the SQL editor): follow the database silently.
    if (!row || (row.base_fingerprint !== liveFingerprint && !isDirty(row))) {
        await rebaseOnLive(projectId, userId, live, row?.document ?? null)
        row = (await one<DraftRow>('SELECT * FROM schema_drafts WHERE project_id = $1', [
            projectId,
        ]))!
    }
    await rememberTableCount(projectId, live.tables.length)

    return {
        document: row.document,
        base: row.base_document.tables,
        revision: row.revision,
        updatedAt: row.updated_at.toISOString(),
        stale: row.base_fingerprint !== liveFingerprint,
        dirty: isDirty(row),
        issues: validateTables(row.document.tables, row.base_document.tables),
        views: live.views,
        schemas: live.schemas,
    }
}

export const saveDraftSchema = z.object({
    document: draftDocumentSchema,
    revision: z.number().int().min(1),
})

export async function saveDraft(
    userId: string,
    projectId: string,
    input: z.infer<typeof saveDraftSchema>,
) {
    await requireProject(userId, projectId)
    if (JSON.stringify(input.document).length > 2_000_000) {
        throw new AppError('payload_too_large', 'The schema draft is too large.')
    }
    // Optimistic concurrency: the update only applies to the revision the
    // client last saw, so two tabs cannot silently overwrite each other.
    const updated = await one<{ revision: number; base_document: { tables: SchemaTable[] } }>(
        `UPDATE schema_drafts
         SET document = $2, revision = revision + 1, updated_by = $3, updated_at = now()
         WHERE project_id = $1 AND revision = $4
         RETURNING revision, base_document`,
        [projectId, JSON.stringify(input.document), userId, input.revision],
    )
    if (!updated) {
        throw new AppError(
            'conflict',
            'The draft was changed in another tab or window. Reload to continue.',
        )
    }
    return {
        revision: updated.revision,
        dirty: diffSchemas(updated.base_document.tables, input.document.tables).steps.length > 0,
        issues: validateTables(input.document.tables, updated.base_document.tables),
    }
}

export async function discardDraft(userId: string, projectId: string) {
    const target = await projectTarget(userId, projectId, 'read')
    const live = await liveSchema(target, { fresh: true })
    const row = await one<DraftRow>('SELECT * FROM schema_drafts WHERE project_id = $1', [
        projectId,
    ])
    await rebaseOnLive(projectId, userId, live, row?.document ?? null)
}

export interface MigrationPlan {
    steps: MigrationStep[]
    sql: string
    destructive: boolean
    summary: ReturnType<typeof diffSchemas>['summary']
    issues: SchemaIssue[]
    baseFingerprint: string
}

async function plan(userId: string, projectId: string): Promise<MigrationPlan> {
    const target = await projectTarget(userId, projectId, 'read')
    const live = await liveSchema(target, { fresh: true })
    const row = await one<DraftRow>('SELECT * FROM schema_drafts WHERE project_id = $1', [
        projectId,
    ])
    if (!row) throw new AppError('conflict', 'Open the schema designer first to create a draft.')
    const liveFingerprint = fingerprint(live.tables)
    if (row.base_fingerprint !== liveFingerprint) {
        throw new AppError(
            'conflict',
            'The database schema changed after this draft was started. Review the draft against the current database before generating a migration.',
            { reason: 'stale_draft' },
        )
    }
    const issues = validateTables(row.document.tables, live.tables)
    const diff = diffSchemas(live.tables, row.document.tables)
    return {
        steps: diff.steps,
        sql: migrationScript(diff.steps),
        destructive: hasDestructiveSteps(diff.steps),
        summary: diff.summary,
        issues,
        baseFingerprint: liveFingerprint,
    }
}

export async function previewMigration(userId: string, projectId: string) {
    return plan(userId, projectId)
}

export const createMigrationSchema = z.object({
    name: z.string().trim().min(1, 'Name the migration.').max(120),
})

export async function createMigration(userId: string, projectId: string, name: string) {
    const planned = await plan(userId, projectId)
    if (hasErrors(planned.issues)) {
        throw new AppError(
            'validation_failed',
            'Fix the errors in the schema before creating a migration.',
            planned.issues,
        )
    }
    if (planned.steps.length === 0)
        throw new AppError('bad_request', 'The draft has no changes to migrate.')
    // Every step must be exactly one statement. This catches anything in the
    // generated SQL (a default expression, say) that would smuggle in more.
    for (const step of planned.steps) {
        if (splitStatements(step.sql).length !== 1) {
            throw new AppError(
                'validation_failed',
                `Step "${step.summary}" did not produce a single statement.`,
            )
        }
    }
    const created = await one<{ id: string }>(
        `INSERT INTO migrations (project_id, name, steps, sql, destructive, base_fingerprint, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
            projectId,
            name,
            JSON.stringify(planned.steps),
            planned.sql,
            planned.destructive,
            planned.baseFingerprint,
            userId,
        ],
    )
    return { id: created!.id }
}

interface MigrationRow {
    id: string
    project_id: string
    name: string
    status: 'draft' | 'applying' | 'applied' | 'failed'
    steps: MigrationStep[]
    sql: string
    destructive: boolean
    base_fingerprint: string
    target_xid: string | null
    error_message: string | null
    error_step: number | null
    duration_ms: number | null
    created_at: Date
    applied_at: Date | null
    created_by_name: string | null
}

function toMigration(row: MigrationRow) {
    return {
        id: row.id,
        name: row.name,
        status: row.status,
        steps: row.steps,
        sql: row.sql,
        destructive: row.destructive,
        errorMessage: row.error_message,
        errorStep: row.error_step,
        durationMs: row.duration_ms,
        createdAt: row.created_at.toISOString(),
        appliedAt: row.applied_at?.toISOString() ?? null,
        createdBy: row.created_by_name,
    }
}

export type Migration = ReturnType<typeof toMigration>

async function reconcile(target: Target, row: MigrationRow): Promise<void> {
    if (row.status !== 'applying' || !row.target_xid) return
    if (Date.now() - row.created_at.getTime() < 60_000) return
    const client = await target.pool.connect()
    try {
        const result = await client.query<{ status: string | null }>(
            'SELECT pg_xact_status($1::xid8) AS status',
            [row.target_xid],
        )
        const status = result.rows[0]?.status
        if (status === 'committed') {
            await query(
                `UPDATE migrations SET status = 'applied', applied_at = now(),
                     error_message = 'Confirmed applied after an interrupted run.'
                 WHERE id = $1 AND status = 'applying'`,
                [row.id],
            )
        } else if (status === 'aborted') {
            await query(
                `UPDATE migrations SET status = 'failed',
                     error_message = 'The run was interrupted; PostgreSQL confirms it was rolled back.'
                 WHERE id = $1 AND status = 'applying'`,
                [row.id],
            )
        }
    } catch (error) {
        log.warn({ err: error, migrationId: row.id }, 'could not reconcile migration')
    } finally {
        client.release()
    }
}

export async function listMigrations(userId: string, projectId: string) {
    await requireProject(userId, projectId)
    const select = `SELECT m.*, u.name AS created_by_name
                    FROM migrations m LEFT JOIN users u ON u.id = m.created_by
                    WHERE m.project_id = $1 ORDER BY m.created_at DESC LIMIT 100`
    let rows = (await query<MigrationRow>(select, [projectId])).rows
    if (rows.some((row) => row.status === 'applying')) {
        const target = await projectTarget(userId, projectId, 'write').catch(() => null)
        if (target) {
            for (const row of rows) await reconcile(target, row)
            rows = (await query<MigrationRow>(select, [projectId])).rows
        }
    }
    return rows.map(toMigration)
}

export async function getMigration(userId: string, projectId: string, migrationId: string) {
    await requireProject(userId, projectId)
    if (!/^[0-9a-f-]{36}$/i.test(migrationId)) throw notFound('Migration')
    const row = await one<MigrationRow>(
        `SELECT m.*, u.name AS created_by_name FROM migrations m
         LEFT JOIN users u ON u.id = m.created_by
         WHERE m.id = $1 AND m.project_id = $2`,
        [migrationId, projectId],
    )
    if (!row) throw notFound('Migration')
    return row
}

export const applyMigrationSchema = z.object({
    confirmDestructive: z.boolean().default(false),
})

export async function applyMigration(
    userId: string,
    projectId: string,
    migrationId: string,
    confirmDestructive: boolean,
) {
    const migration = await getMigration(userId, projectId, migrationId)
    if (migration.status === 'applied')
        throw new AppError('conflict', 'This migration has already been applied.')
    if (migration.status === 'applying')
        throw new AppError('conflict', 'This migration is already running.')
    if (migration.destructive && !confirmDestructive) {
        throw new AppError(
            'validation_failed',
            'This migration deletes data. Confirm the destructive steps to apply it.',
        )
    }

    const target = await projectTarget(userId, projectId, 'write')
    const live = await liveSchema(target, { fresh: true })
    if (fingerprint(live.tables) !== migration.base_fingerprint) {
        throw new AppError(
            'conflict',
            'The database changed after this migration was generated. Generate a new migration from the current draft.',
            { reason: 'stale_migration' },
        )
    }

    // Claim the migration; the WHERE clause makes concurrent applies lose.
    const claimed = await one<{ id: string }>(
        `UPDATE migrations SET status = 'applying', error_message = NULL, error_step = NULL
         WHERE id = $1 AND status IN ('draft', 'failed') RETURNING id`,
        [migrationId],
    )
    if (!claimed) throw new AppError('conflict', 'This migration is already running or applied.')

    const started = performance.now()
    const client = await target.pool.connect()
    let destroy = false
    let step = -1
    try {
        await client.query('BEGIN')
        await client.query(`SET LOCAL lock_timeout = '5s'`)
        await client.query(`SET LOCAL statement_timeout = '60s'`)
        const xid = await client.query<{ xid: string }>('SELECT pg_current_xact_id()::text AS xid')
        await query('UPDATE migrations SET target_xid = $2 WHERE id = $1', [
            migrationId,
            xid.rows[0]!.xid,
        ])
        for (const [index, migrationStep] of migration.steps.entries()) {
            step = index
            // The extended protocol accepts exactly one statement per message.
            const statement = { text: migrationStep.sql, queryMode: 'extended' as const }
            await client.query(statement)
        }
        await client.query('COMMIT')
    } catch (error) {
        await client.query('ROLLBACK').catch(() => (destroy = true))
        const pg = error as { message: string; detail?: string }
        const message = pg.detail ? `${pg.message} (${pg.detail})` : pg.message
        await query(
            `UPDATE migrations SET status = 'failed', error_message = $2, error_step = $3, duration_ms = $4
             WHERE id = $1`,
            [
                migrationId,
                message.slice(0, 1000),
                step >= 0 ? step : null,
                Math.round(performance.now() - started),
            ],
        )
        await recordActivity({
            userId,
            projectId,
            kind: 'migration.failed',
            message: `Migration "${migration.name}" failed and was rolled back`,
        })
        invalidateSchema(target.connection.id)
        return { status: 'failed' as const, error: message, errorStep: step }
    } finally {
        client.release(destroy)
    }

    const durationMs = Math.round(performance.now() - started)
    await query(
        `UPDATE migrations SET status = 'applied', applied_at = now(), duration_ms = $2 WHERE id = $1`,
        [migrationId, durationMs],
    )
    await query('UPDATE projects SET schema_changed_at = now(), updated_at = now() WHERE id = $1', [
        projectId,
    ])
    await recordActivity({
        userId,
        projectId,
        kind: 'migration.applied',
        message: `Applied migration "${migration.name}" (${migration.steps.length} step${migration.steps.length === 1 ? '' : 's'})`,
    })

    // The draft now matches the database: rebase it, keeping canvas positions.
    invalidateSchema(target.connection.id)
    const fresh = await liveSchema(target, { fresh: true })
    const draft = await one<DraftRow>('SELECT * FROM schema_drafts WHERE project_id = $1', [
        projectId,
    ])
    await rebaseOnLive(projectId, userId, fresh, draft?.document ?? null)
    return { status: 'applied' as const, durationMs }
}

export async function deleteMigration(userId: string, projectId: string, migrationId: string) {
    const migration = await getMigration(userId, projectId, migrationId)
    if (migration.status === 'applied' || migration.status === 'applying') {
        throw new AppError('conflict', 'Applied migrations are kept as history.')
    }
    await query('DELETE FROM migrations WHERE id = $1', [migrationId])
}

export { toMigration }
