import pg from 'pg'
import { describe, expect, it } from 'vitest'
import {
    applyMigration,
    createMigration,
    getDraft,
    listMigrations,
    previewMigration,
    saveDraft,
} from '@/server/migrations/service'
import { executeScript } from '@/server/query/executor'
import { introspect } from '@/server/schema/introspect'
import { projectTarget } from '@/server/targets/connections'
import { adminPool } from '@/server/targets/provisioner'
import { exportSchemaSql } from '@/server/transfer/export'
import { newId, type DraftDocument, type SchemaTable } from '@/shared/schema/model'
import { createProjectWithSandbox, createUser, type TestUser } from '../support/factory'

async function edit(owner: TestUser, projectId: string, change: (document: DraftDocument) => void) {
    const draft = await getDraft(owner.user.id, projectId)
    const document = structuredClone(draft.document)
    change(document)
    await saveDraft(owner.user.id, projectId, { document, revision: draft.revision })
}

async function migrateTo(owner: TestUser, projectId: string, name: string, confirm = false) {
    const { id } = await createMigration(owner.user.id, projectId, name)
    return { id, result: await applyMigration(owner.user.id, projectId, id, confirm) }
}

const byName = (tables: SchemaTable[], name: string) => tables.find((table) => table.name === name)!

describe('introspection', () => {
    it('reads tables, keys, relationships, checks and views from the catalog', async () => {
        const owner = await createUser()
        const projectId = await createProjectWithSandbox(owner, 'ecommerce')
        const target = await projectTarget(owner.user.id, projectId, 'read')
        const client = await target.pool.connect()
        const live = await introspect(client)
        client.release()
        expect(live.tables.map((table) => table.name).sort()).toEqual([
            'categories',
            'order_items',
            'orders',
            'payments',
            'products',
            'users',
        ])
        const items = byName(live.tables, 'order_items')
        expect(items.primaryKey?.columns).toHaveLength(2)
        expect(
            items.foreignKeys.map(
                (key) =>
                    byName(live.tables, 'orders').id === key.refTableId ||
                    byName(live.tables, 'products').id === key.refTableId,
            ),
        ).toEqual([true, true])
        expect(byName(live.tables, 'categories').foreignKeys[0]).toMatchObject({
            onDelete: 'SET NULL',
        })
        expect(byName(live.tables, 'products').checks.length).toBeGreaterThan(0)
        expect(byName(live.tables, 'users').columns[0]).toMatchObject({
            name: 'id',
            type: 'bigint',
            identity: 'always',
            nullable: false,
        })
        expect(live.views.map((view) => view.name)).toContain('order_summaries')
    })
})

describe('designer migrations against a real database', () => {
    it('creates a table with a relationship, renames, changes types and applies in one transaction', async () => {
        const owner = await createUser()
        const projectId = await createProjectWithSandbox(owner, 'ecommerce')
        await edit(owner, projectId, (document) => {
            const products = byName(document.tables, 'products')
            const users = byName(document.tables, 'users')
            users.columns.find((column) => column.name === 'full_name')!.name = 'display_name'
            users.columns.find((column) => column.name === 'display_name')!.type = 'varchar(200)'
            const id = newId()
            const productId = newId()
            document.tables.push({
                id: newId(),
                schema: 'public',
                name: 'reviews',
                comment: 'Product reviews',
                columns: [
                    {
                        id,
                        name: 'id',
                        type: 'bigint',
                        nullable: false,
                        default: null,
                        identity: 'always',
                        generated: null,
                        comment: null,
                    },
                    {
                        id: productId,
                        name: 'product_id',
                        type: 'bigint',
                        nullable: false,
                        default: null,
                        identity: null,
                        generated: null,
                        comment: null,
                    },
                    {
                        id: newId(),
                        name: 'rating',
                        type: 'smallint',
                        nullable: false,
                        default: '5',
                        identity: null,
                        generated: null,
                        comment: null,
                    },
                ],
                primaryKey: { id: newId(), name: null, columns: [id] },
                uniques: [],
                foreignKeys: [
                    {
                        id: newId(),
                        name: null,
                        columns: [productId],
                        refTableId: products.id,
                        refColumns: products.primaryKey!.columns,
                        onDelete: 'CASCADE',
                        onUpdate: 'NO ACTION',
                    },
                ],
                checks: [],
                indexes: [],
                rowEstimate: null,
            })
        })
        const preview = await previewMigration(owner.user.id, projectId)
        expect(preview.destructive).toBe(false)
        expect(preview.steps.map((step) => step.kind)).toEqual([
            'rename_column',
            'alter_column_type',
            'create_table',
            'add_foreign_key',
            'comment',
        ])

        const { result } = await migrateTo(owner, projectId, 'Reviews')
        expect(result.status).toBe('applied')

        // The database really changed, and the draft is in sync again.
        const insert = await executeScript(owner.user.id, projectId, {
            sql: 'insert into reviews (product_id) values (1) returning rating; select display_name from users limit 1',
            mode: 'write',
        })
        expect(insert.status).toBe('success')
        expect(insert.results[0]!.rows[0]).toEqual([5])
        const draft = await getDraft(owner.user.id, projectId)
        expect(draft).toMatchObject({ dirty: false, stale: false })
        const [migration] = await listMigrations(owner.user.id, projectId)
        expect(migration).toMatchObject({ status: 'applied', name: 'Reviews' })
    })

    it('marks a migration failed and leaves the database untouched when a step fails', async () => {
        const owner = await createUser()
        const projectId = await createProjectWithSandbox(owner, 'ecommerce')
        await edit(owner, projectId, (document) => {
            const users = byName(document.tables, 'users')
            users.columns.push({
                id: newId(),
                name: 'tier',
                type: 'text',
                nullable: false,
                default: null,
                identity: null,
                generated: null,
                comment: null,
            })
            users.columns.find((column) => column.name === 'country')!.name = 'country_code'
        })
        const { id, result } = await migrateTo(owner, projectId, 'Add required tier')
        expect(result).toMatchObject({ status: 'failed', errorStep: 1 })
        const [migration] = await listMigrations(owner.user.id, projectId)
        expect(migration).toMatchObject({ id, status: 'failed', errorStep: 1 })
        expect(migration!.errorMessage).toMatch(/contains null values/)
        // Step 0 (the rename) was rolled back with the rest.
        const check = await executeScript(owner.user.id, projectId, {
            sql: 'select country from users limit 1',
            mode: 'read',
        })
        expect(check.status).toBe('success')
    })

    it('requires confirmation for destructive migrations', async () => {
        const owner = await createUser()
        const projectId = await createProjectWithSandbox(owner, 'ecommerce')
        await edit(owner, projectId, (document) => {
            const users = byName(document.tables, 'users')
            users.columns = users.columns.filter((column) => column.name !== 'marketing_opt_in')
        })
        const { id } = await createMigration(owner.user.id, projectId, 'Drop opt-in')
        await expect(applyMigration(owner.user.id, projectId, id, false)).rejects.toThrow(
            /Confirm the destructive steps/,
        )
        expect((await applyMigration(owner.user.id, projectId, id, true)).status).toBe('applied')
    })

    it('refuses to apply a migration generated against an older schema', async () => {
        const owner = await createUser()
        const projectId = await createProjectWithSandbox(owner, 'ecommerce')
        await edit(owner, projectId, (document) => {
            byName(document.tables, 'categories').comment = 'Changed'
        })
        const { id } = await createMigration(owner.user.id, projectId, 'Comment')
        await executeScript(owner.user.id, projectId, {
            sql: 'create table sneaky (id int)',
            mode: 'write',
        })
        await expect(applyMigration(owner.user.id, projectId, id, false)).rejects.toThrow(
            /changed after this migration was generated/,
        )
        await expect(previewMigration(owner.user.id, projectId)).rejects.toThrow(
            /changed after this draft was started/,
        )
    })

    it('rejects invalid drafts before generating SQL', async () => {
        const owner = await createUser()
        const projectId = await createProjectWithSandbox(owner, 'ecommerce')
        await edit(owner, projectId, (document) => {
            byName(document.tables, 'orders').name = 'users'
        })
        await expect(createMigration(owner.user.id, projectId, 'Broken')).rejects.toThrow(
            /Fix the errors/,
        )
    })

    it('refuses concurrent edits to the same draft', async () => {
        const owner = await createUser()
        const projectId = await createProjectWithSandbox(owner, 'ecommerce')
        const draft = await getDraft(owner.user.id, projectId)
        await saveDraft(owner.user.id, projectId, {
            document: draft.document,
            revision: draft.revision,
        })
        await expect(
            saveDraft(owner.user.id, projectId, {
                document: draft.document,
                revision: draft.revision,
            }),
        ).rejects.toThrow(/another tab/)
    })

    it('exports a schema script that recreates the structure in an empty database', async () => {
        const owner = await createUser()
        const projectId = await createProjectWithSandbox(owner, 'ecommerce')
        const script = await exportSchemaSql(owner.user.id, projectId)
        await adminPool().query('DROP DATABASE IF EXISTS roundtrip')
        await adminPool().query('CREATE DATABASE roundtrip TEMPLATE template0')
        const client = new pg.Client({
            connectionString: process.env.SUPERUSER_URL!.replace(/\/[^/]+$/, '/roundtrip'),
        })
        await client.connect()
        try {
            await client.query(script)
            const live = await introspect(client)
            expect(live.tables).toHaveLength(6)
            expect(live.tables.reduce((sum, table) => sum + table.foreignKeys.length, 0)).toBe(6)
            expect(live.views.map((view) => view.name)).toEqual(['order_summaries'])
        } finally {
            await client.end()
            await adminPool().query('DROP DATABASE roundtrip WITH (FORCE)')
        }
    })
})
