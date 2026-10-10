import { describe, expect, it } from 'vitest'
import type { DraftDocument } from '@/shared/schema/model'
import {
    addColumn,
    addRelationship,
    addTable,
    connectColumns,
    deleteColumn,
    deleteTable,
    togglePrimaryKey,
    updateColumn,
} from '@/features/designer/operations'
import { baseSchema } from '../support/schema-fixtures'

const doc = (): DraftDocument => ({ version: 1, tables: baseSchema(), positions: {} })

describe('designer operations', () => {
    it('adds a table with an identity primary key and a unique name', () => {
        const first = addTable(doc(), { x: 0, y: 0 })
        const second = addTable(first.document, { x: 10, y: 0 })
        const created = second.document.tables.at(-1)!
        expect(created.name).toBe('new_table_2')
        expect(created.primaryKey?.columns).toEqual([created.columns[0]!.id])
        expect(created.columns[0]).toMatchObject({ identity: 'always', nullable: false })
    })

    it('removes relationships that pointed at a deleted table', () => {
        const next = deleteTable(doc(), 't1')
        expect(next.tables.find((table) => table.name === 'orders')!.foreignKeys).toEqual([])
    })

    it('removes keys and relationships that used a deleted column', () => {
        const next = deleteColumn(doc(), 't1', 'c1.1')
        const users = next.tables.find((table) => table.id === 't1')!
        expect(users.primaryKey).toBeNull()
        expect(next.tables.find((table) => table.id === 't2')!.foreignKeys).toEqual([])
    })

    it('makes primary key and identity columns NOT NULL', () => {
        let next = addColumn(doc(), 't1').document
        const added = next.tables[0]!.columns.at(-1)!
        next = togglePrimaryKey(next, 't1', added.id)
        expect(next.tables[0]!.columns.at(-1)!.nullable).toBe(false)
        next = updateColumn(next, 't1', added.id, {
            identity: 'always',
            type: 'text',
            default: "'x'",
        })
        expect(next.tables[0]!.columns.at(-1)).toMatchObject({
            type: 'bigint',
            default: null,
            nullable: false,
        })
    })

    it('keeps the primary key id stable when toggled back', () => {
        const toggled = togglePrimaryKey(togglePrimaryKey(doc(), 't2', 'c2.2'), 't2', 'c2.2')
        expect(toggled.tables[1]!.primaryKey).toEqual(doc().tables[1]!.primaryKey)
    })

    it('connects a column to a key, flipping the direction when dragged from the key', () => {
        let next = addColumn(doc(), 't1').document
        const plain = next.tables[0]!.columns.at(-1)!
        const result = connectColumns(
            next,
            { tableId: 't2', columnId: 'c2.1' },
            { tableId: 't1', columnId: plain.id },
        )
        expect(result).toHaveProperty('document')
        if ('document' in result) {
            next = result.document
            const key = next.tables[0]!.foreignKeys.at(-1)!
            expect(key).toMatchObject({
                columns: [plain.id],
                refTableId: 't2',
                refColumns: ['c2.1'],
            })
        }
    })

    it('refuses to reference a column that is not a key', () => {
        const result = connectColumns(
            doc(),
            { tableId: 't2', columnId: 'c2.2' },
            { tableId: 't2', columnId: 'c2.3' },
        )
        expect(result).toEqual({
            error: expect.stringContaining('must be a primary key or unique'),
        })
    })

    it('treats a drag from a key to a plain column as the plain column referencing the key', () => {
        const result = connectColumns(
            doc(),
            { tableId: 't1', columnId: 'c1.1' },
            { tableId: 't2', columnId: 'c2.3' },
        )
        expect('document' in result && result.document.tables[1]!.foreignKeys.at(-1)).toMatchObject(
            { columns: ['c2.3'], refTableId: 't1' },
        )
    })

    it('creates a matching column when adding a relationship', () => {
        const result = addRelationship(doc(), 't1', 't2')
        expect('document' in result).toBe(true)
        if ('document' in result) {
            const users = result.document.tables[0]!
            expect(users.columns.at(-1)).toMatchObject({
                name: 'order_id',
                type: 'bigint',
                nullable: false,
            })
            expect(users.foreignKeys).toHaveLength(1)
        }
    })
})
