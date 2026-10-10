import 'server-only'
import { appPool, type Queryable } from '@/server/db/app-db'

// Activity feed entries shown on the dashboard and project overview. Messages
// describe what happened; they never contain SQL text or row data.

export type ActivityKind =
    | 'project.created'
    | 'project.renamed'
    | 'database.provisioned'
    | 'database.connected'
    | 'database.removed'
    | 'migration.applied'
    | 'migration.failed'
    | 'data.imported'
    | 'data.changed'

export async function recordActivity(
    entry: { userId: string; projectId: string | null; kind: ActivityKind; message: string },
    db: Queryable = appPool(),
) {
    await db.query(
        `INSERT INTO activity (user_id, project_id, kind, message) VALUES ($1, $2, $3, $4)`,
        [entry.userId, entry.projectId, entry.kind, entry.message.slice(0, 300)],
    )
}
