import { describe, expect, it } from 'vitest'
import { defaultExpressionProblem, hasErrors, validateTables } from '@/shared/schema/validate'
import { baseSchema, column, table } from '../support/schema-fixtures'

const messages = (tables = baseSchema()) => validateTables(tables).map((issue) => issue.message)

describe('validateTables', () => {
    it('accepts a valid schema', () => {
        expect(hasErrors(validateTables(baseSchema()))).toBe(false)
    })

    it('rejects duplicate table and column names', () => {
        const tables = baseSchema()
        tables[1]!.name = 'users'
        tables[0]!.columns[1]!.name = 'id'
        const found = messages(tables)
        expect(found).toContain('Another table is already named "users"')
        expect(found.some((message) => message.includes('Duplicate column "id"'))).toBe(true)
    })

    it('requires referenced columns to be a primary key or unique', () => {
        const tables = baseSchema()
        tables[1]!.foreignKeys[0]!.refColumns = ['c1.2']
        tables[0]!.uniques = []
        expect(
            messages(tables).some((message) => message.includes('must be a primary key or unique')),
        ).toBe(true)
    })

    it('rejects incompatible foreign key types', () => {
        const tables = baseSchema()
        tables[1]!.columns[1]!.type = 'uuid'
        expect(messages(tables).some((message) => message.includes('cannot reference'))).toBe(true)
    })

    it('rejects SET NULL on a NOT NULL column', () => {
        const tables = baseSchema()
        tables[1]!.foreignKeys[0]!.onDelete = 'SET NULL'
        expect(
            messages(tables).some((message) =>
                message.includes('SET NULL needs a nullable column'),
            ),
        ).toBe(true)
    })

    it('enforces identity rules', () => {
        const tables = [
            table('t9', 'things', [
                column('c9', 'id', 'text', { identity: 'always', nullable: true, default: "'x'" }),
            ]),
        ]
        const found = messages(tables)
        expect(
            found.some((message) => message.includes('identity needs smallint, integer or bigint')),
        ).toBe(true)
        expect(found.some((message) => message.includes('must be NOT NULL'))).toBe(true)
        expect(found.some((message) => message.includes('cannot have a default'))).toBe(true)
    })

    it('warns about a missing primary key', () => {
        const issues = validateTables([table('t9', 'logs', [column('c9', 'line', 'text')])])
        expect(issues).toEqual([expect.objectContaining({ severity: 'warning' })])
    })

    it('rejects names over 63 bytes', () => {
        const tables = baseSchema()
        tables[0]!.name = 'x'.repeat(64)
        expect(messages(tables).some((message) => message.includes('longer than 63 bytes'))).toBe(
            true,
        )
    })
})

describe('defaultExpressionProblem', () => {
    it.each(["'pending'", 'now()', "'{}'::jsonb", '0', "'it''s'", 'coalesce(1, 2)'])(
        'accepts %s',
        (expression) => {
            expect(defaultExpressionProblem(expression)).toBeNull()
        },
    )
    it.each([
        ['0); drop table users; --', /semicolon/],
        ["'a' -- b", /comments/],
        ['1 /* x */', /comments/],
        ['$$x$$', /dollar/],
        ['(1', /parentheses/],
        ["'open", /unterminated/],
    ])('rejects %s', (expression, problem) => {
        expect(defaultExpressionProblem(expression)).toMatch(problem)
    })
})
