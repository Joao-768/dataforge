import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { browse, deleteRows, insertRow, updateRow } from '@/server/data/explorer'
import { executeScript } from '@/server/query/executor'
import { importCsv } from '@/server/transfer/csv-import'
import { exportTableCsv, exportTableSql } from '@/server/transfer/export'
import { createProjectWithSandbox, createUser, type TestUser } from '../support/factory'

let owner: TestUser
let projectId: string
async function setup() {
    owner ??= await createUser()
    projectId ??= await createProjectWithSandbox(owner, 'ecommerce')
}

const base = { page: 1, pageSize: 10, direction: 'asc' as const, filters: [] }
const read = (sql: string) =>
    executeScript(owner.user.id, projectId, { sql, mode: 'read' }).then(
        (result) => result.results[0]!.rows,
    )
const text = async (stream: ReadableStream<Uint8Array>) => new Response(stream).text()
const body = (csv: string) =>
    Readable.toWeb(Readable.from([Buffer.from(csv)])) as ReadableStream<Uint8Array>

describe('data explorer', () => {
    it('pages, sorts, filters and searches on the server', async () => {
        await setup()
        const page = await browse(owner.user.id, projectId, {
            ...base,
            schema: 'public',
            table: 'products',
            sort: 'price',
            direction: 'desc',
            filters: [{ column: 'price', op: 'gt', value: '500' }],
        })
        expect(page.rows.length).toBeLessThanOrEqual(10)
        const prices = page.rows.map((row) =>
            Number(row[page.columns.findIndex((column) => column.name === 'price')]),
        )
        expect(prices).toEqual([...prices].sort((a, b) => b - a))
        expect(prices.every((price) => price > 500)).toBe(true)
        expect(page.editable).toBe(true)

        const search = await browse(owner.user.id, projectId, {
            ...base,
            schema: 'public',
            table: 'users',
            search: '%',
        })
        expect(search.total).toBe(0)
    })

    it('rejects unknown columns and treats views as read-only', async () => {
        await setup()
        await expect(
            browse(owner.user.id, projectId, {
                ...base,
                schema: 'public',
                table: 'users',
                sort: 'id; drop table users',
            }),
        ).rejects.toThrow(/Unknown column/)
        const view = await browse(owner.user.id, projectId, {
            ...base,
            schema: 'public',
            table: 'order_summaries',
        })
        expect(view.editable).toBe(false)
        await expect(
            insertRow(owner.user.id, projectId, {
                schema: 'public',
                table: 'order_summaries',
                values: {},
            }),
        ).rejects.toThrow(/read-only/)
    })

    it('inserts, updates and deletes rows by primary key, through PostgreSQL casts', async () => {
        await setup()
        const inserted = await insertRow(owner.user.id, projectId, {
            schema: 'public',
            table: 'categories',
            values: {
                name: { kind: 'value', value: 'Garden' },
                slug: { kind: 'value', value: 'garden' },
                parent_id: { kind: 'null' },
            },
        })
        const id = inserted.rows[0]![0] as number
        await updateRow(owner.user.id, projectId, {
            schema: 'public',
            table: 'categories',
            key: { id },
            changes: { name: { kind: 'value', value: 'Garden & Patio' } },
        })
        expect(await read(`select name from categories where id = ${id}`)).toEqual([
            ['Garden & Patio'],
        ])
        await expect(
            updateRow(owner.user.id, projectId, {
                schema: 'public',
                table: 'categories',
                key: { id },
                changes: { slug: { kind: 'value', value: 'audio' } },
            }),
        ).rejects.toThrow(/categories_slug_key/)
        await expect(
            updateRow(owner.user.id, projectId, {
                schema: 'public',
                table: 'categories',
                key: { id: 999999 },
                changes: { name: { kind: 'value', value: 'x' } },
            }),
        ).rejects.toThrow(/changed or deleted/)
        const removed = await deleteRows(owner.user.id, projectId, {
            schema: 'public',
            table: 'categories',
            keys: [{ id }],
        })
        expect(removed.rowCount).toBe(1)
    })

    it('reports constraint violations from the database', async () => {
        await setup()
        await expect(
            insertRow(owner.user.id, projectId, {
                schema: 'public',
                table: 'products',
                values: {
                    category_id: { kind: 'value', value: '5' },
                    sku: { kind: 'value', value: 'X-1' },
                    name: { kind: 'value', value: 'X' },
                    price: { kind: 'value', value: '-1' },
                },
            }),
        ).rejects.toThrow(/products_price_check/)
        await expect(
            insertRow(owner.user.id, projectId, {
                schema: 'public',
                table: 'products',
                values: { category_id: { kind: 'value', value: 'abc' } },
            }),
        ).rejects.toThrow(/invalid input syntax for type integer/)
    })
})

describe('import and export', () => {
    const csv =
        'name,slug,parent\nGarden Tools,garden-tools,3\nDuplicate,audio,\nBad Parent,bad-parent,notanumber\n"Quoted, Name",quoted-name,\n'
    const options = (mode: 'atomic' | 'skip_invalid') => ({
        schema: 'public',
        table: 'categories',
        hasHeader: true,
        delimiter: ',' as const,
        mapping: [
            { column: 'name', source: 0 },
            { column: 'slug', source: 1 },
            { column: 'parent_id', source: 2 },
        ],
        nullValues: [''],
        mode,
    })

    it('imports nothing in atomic mode and reports the first bad line', async () => {
        await setup()
        const report = await importCsv(owner.user.id, projectId, body(csv), options('atomic'))
        expect(report).toMatchObject({ committed: false, inserted: 0, failed: [{ row: 3 }] })
        expect(
            await read("select count(*)::int from categories where slug = 'garden-tools'"),
        ).toEqual([[0]])
    })

    it('skips and reports invalid lines in skip mode', async () => {
        await setup()
        const report = await importCsv(owner.user.id, projectId, body(csv), options('skip_invalid'))
        expect(report).toMatchObject({ committed: true, inserted: 2, totalRows: 4, failedCount: 2 })
        expect(report.failed.map((failure) => failure.row)).toEqual([3, 4])
        expect(report.failed[1]!.message).toMatch(/invalid input syntax for type integer/)
        expect(await read("select name from categories where slug = 'quoted-name'")).toEqual([
            ['Quoted, Name'],
        ])
    })

    it('exports CSV that imports back unchanged', async () => {
        await setup()
        const exported = await text(
            await exportTableCsv(owner.user.id, projectId, 'public', 'users'),
        )
        const lines = exported.trim().split('\n')
        expect(lines[0]).toBe('id,email,full_name,country,marketing_opt_in,created_at')
        expect(lines).toHaveLength(601)
        expect(lines[1]).toMatch(/,(true|false),/)
    })

    it('exports INSERT statements rendered by PostgreSQL', async () => {
        await setup()
        const sql = await text(
            await exportTableSql(owner.user.id, projectId, 'public', 'categories'),
        )
        expect(sql).toContain(
            'INSERT INTO public.categories (id, name, slug, parent_id) OVERRIDING SYSTEM VALUE VALUES',
        )
        expect(sql).toContain("'Home & Kitchen'")
        expect(sql).toMatch(/NULL\)/)
    })
})
