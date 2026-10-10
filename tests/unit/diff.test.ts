import { describe, expect, it } from 'vitest'
import { diffSchemas, migrationScript } from '@/shared/schema/diff'
import { splitStatements } from '@/shared/sql/split'
import { baseSchema, column, table } from '../support/schema-fixtures'

const clone = <T>(value: T): T => structuredClone(value)
const kinds = (base = baseSchema(), target = baseSchema()) =>
    diffSchemas(base, target).steps.map((step) => step.kind)

describe('diffSchemas', () => {
    it('finds nothing to do for identical schemas', () => {
        expect(diffSchemas(baseSchema(), baseSchema()).steps).toEqual([])
    })

    it('creates new tables with keys inline and foreign keys afterwards', () => {
        const target = baseSchema()
        target.push(
            table(
                'n_reviews',
                'reviews',
                [
                    column('n_a', 'id', 'bigint', { nullable: false, identity: 'always' }),
                    column('n_b', 'order_id', 'bigint', { nullable: false }),
                ],
                {
                    primaryKey: { id: 'n_pk', name: null, columns: ['n_a'] },
                    foreignKeys: [
                        {
                            id: 'n_fk',
                            name: null,
                            columns: ['n_b'],
                            refTableId: 't2',
                            refColumns: ['c2.1'],
                            onDelete: 'CASCADE',
                            onUpdate: 'NO ACTION',
                        },
                    ],
                    rowEstimate: null,
                },
            ),
        )
        const { steps, summary } = diffSchemas(baseSchema(), target)
        expect(steps.map((step) => step.kind)).toEqual(['create_table', 'add_foreign_key'])
        expect(steps[0]!.sql).toContain('CREATE TABLE public.reviews')
        expect(steps[0]!.sql).toContain('CONSTRAINT reviews_pkey PRIMARY KEY (id)')
        expect(steps[1]!.sql).toBe(
            'ALTER TABLE public.reviews ADD CONSTRAINT reviews_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders (id) ON DELETE CASCADE',
        )
        expect(summary.tablesAdded).toEqual(['public.reviews'])
    })

    it('detects renames by identity instead of dropping and adding', () => {
        const target = baseSchema()
        target[0]!.name = 'accounts'
        target[0]!.columns[1]!.name = 'email_address'
        const { steps } = diffSchemas(baseSchema(), target)
        expect(steps.map((step) => step.sql)).toEqual([
            'ALTER TABLE public.users RENAME TO accounts',
            'ALTER TABLE public.accounts RENAME COLUMN email TO email_address',
        ])
        expect(steps.every((step) => !step.destructive)).toBe(true)
    })

    it('swaps names through temporary names', () => {
        const target = baseSchema()
        target[0]!.name = 'orders'
        target[1]!.name = 'users'
        const sql = diffSchemas(baseSchema(), target).steps.map((step) => step.sql)
        expect(sql).toEqual([
            'ALTER TABLE public.users RENAME TO _df_rename_0',
            'ALTER TABLE public.orders RENAME TO _df_rename_1',
            'ALTER TABLE public._df_rename_0 RENAME TO orders',
            'ALTER TABLE public._df_rename_1 RENAME TO users',
        ])
    })

    it('marks dropped tables and columns as destructive', () => {
        const target = baseSchema()
        target[1]!.columns = target[1]!.columns.filter((col) => col.name !== 'note')
        const { steps } = diffSchemas(baseSchema(), target)
        expect(steps).toHaveLength(1)
        expect(steps[0]).toMatchObject({ kind: 'drop_column', destructive: true })

        const withoutOrders = baseSchema().slice(0, 1)
        const drop = diffSchemas(baseSchema(), withoutOrders).steps
        expect(drop.map((step) => step.kind)).toEqual(['drop_table'])
        expect(drop[0]!.destructive).toBe(true)
    })

    it('treats widening type changes as safe and narrowing as destructive', () => {
        const widened = baseSchema()
        widened[1]!.columns[2]!.type = 'varchar(200)'
        expect(diffSchemas(baseSchema(), widened).steps[0]).toMatchObject({
            kind: 'alter_column_type',
            destructive: false,
        })
        const narrowed = baseSchema()
        narrowed[1]!.columns[2]!.type = 'varchar(10)'
        expect(diffSchemas(baseSchema(), narrowed).steps[0]).toMatchObject({ destructive: true })
    })

    it('orders nullability, defaults and identity changes correctly', () => {
        const target = baseSchema()
        const note = target[1]!.columns[2]!
        note.nullable = false
        note.default = "'n/a'"
        expect(kinds(baseSchema(), target)).toEqual(['set_default', 'set_not_null'])
        const back = clone(target)
        back[1]!.columns[2]!.nullable = true
        back[1]!.columns[2]!.default = null
        expect(kinds(target, back)).toEqual(['drop_default', 'drop_not_null'])
    })

    it('warns when adding a NOT NULL column without default to a table with rows', () => {
        const target = baseSchema()
        target[0]!.columns.push(column('n_c', 'country', 'char(2)', { nullable: false }))
        const step = diffSchemas(baseSchema(), target).steps[0]!
        expect(step.kind).toBe('add_column')
        expect(step.warning).toMatch(/fails if the table already has rows/)
    })

    it('rebuilds foreign keys that depend on a primary key being changed', () => {
        const target = baseSchema()
        target[0]!.columns.push(column('n_k', 'tenant_id', 'bigint', { nullable: false }))
        target[0]!.primaryKey = { id: 'k1', name: 'users_pkey', columns: ['c1.1', 'n_k'] }
        target[0]!.uniques.push({ id: 'n_u', name: null, columns: ['c1.1'] })
        const sequence = kinds(baseSchema(), target)
        expect(sequence.indexOf('drop_foreign_key')).toBeLessThan(
            sequence.indexOf('drop_primary_key'),
        )
        expect(sequence.indexOf('add_primary_key')).toBeLessThan(
            sequence.indexOf('add_foreign_key'),
        )
    })

    it('changes referential actions by dropping and re-adding the constraint', () => {
        const target = baseSchema()
        target[1]!.foreignKeys[0]!.onDelete = 'CASCADE'
        const { steps } = diffSchemas(baseSchema(), target)
        expect(steps.map((step) => step.kind)).toEqual(['drop_foreign_key', 'add_foreign_key'])
        expect(steps[1]!.sql).toContain('ON DELETE CASCADE')
    })

    it('generates one statement per step', () => {
        const target = baseSchema()
        target[0]!.comment = "Customer's accounts; one per email"
        target[1]!.columns[2]!.default = "';'"
        const { steps } = diffSchemas(baseSchema(), target)
        for (const step of steps) expect(splitStatements(step.sql)).toHaveLength(1)
        expect(splitStatements(migrationScript(steps))).toHaveLength(steps.length)
    })
})
