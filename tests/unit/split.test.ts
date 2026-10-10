import { describe, expect, it } from 'vitest'
import {
    hasCode,
    isTransactionControl,
    leadingKeyword,
    splitStatements,
    statementAt,
} from '@/shared/sql/split'

const texts = (sql: string) => splitStatements(sql).map((statement) => statement.text)

describe('splitStatements', () => {
    it('splits on top-level semicolons and trims', () => {
        expect(texts('select 1;  select 2 ;\n\nselect 3')).toEqual([
            'select 1',
            'select 2',
            'select 3',
        ])
    })

    it('ignores semicolons inside strings, identifiers and comments', () => {
        const sql = `select 'a;b', "we;ird" from t -- trailing; comment
        ; select /* block; comment */ 2`
        expect(texts(sql)).toEqual([
            `select 'a;b', "we;ird" from t -- trailing; comment`,
            'select /* block; comment */ 2',
        ])
    })

    it('handles doubled quotes and escape strings', () => {
        expect(texts(`select 'it''s;fine'; select E'back\\';slash'; select 3`)).toHaveLength(3)
    })

    it('keeps dollar-quoted bodies whole, with and without tags', () => {
        const sql = `do $$ begin perform 1; end $$; create function f() returns int as $body$ select 1; $body$ language sql; select 1`
        expect(texts(sql)).toHaveLength(3)
    })

    it('does not treat positional parameters as dollar quotes', () => {
        expect(texts('select $1; select $2')).toEqual(['select $1', 'select $2'])
    })

    it('supports nested block comments', () => {
        expect(texts('select 1 /* outer /* inner; */ still; comment */; select 2')).toHaveLength(2)
    })

    it('drops statements that are only whitespace or comments', () => {
        expect(texts(';; -- nothing\n; /* x */ ;')).toEqual([])
        expect(hasCode('  -- c\n /* d */ ')).toBe(false)
    })

    it('reports offsets into the original script', () => {
        const sql = '  select 1;\n  select 2'
        const [first, second] = splitStatements(sql)
        expect(sql.slice(first!.start, first!.end)).toBe('select 1')
        expect(sql.slice(second!.start, second!.end)).toBe('select 2')
    })
})

describe('statementAt', () => {
    it('finds the statement under the cursor', () => {
        const sql = 'select 1;\nselect 2;\nselect 3'
        expect(statementAt(sql, sql.indexOf('2'))?.text).toBe('select 2')
        expect(statementAt(sql, sql.length)?.text).toBe('select 3')
    })
})

describe('transaction control detection', () => {
    it.each([
        ['BEGIN', true],
        ['  commit', true],
        ['/* sneaky */ ROLLBACK', true],
        ['start transaction read write', true],
        ['set transaction read write', true],
        ['SET SESSION CHARACTERISTICS AS TRANSACTION READ WRITE', true],
        ['set default_transaction_read_only = off', true],
        ["prepare transaction 'x'", true],
        ['prepare q as select 1', false],
        ['set search_path = public', false],
        ['select 1', false],
        ['(select 1)', false],
    ])('%s -> %s', (sql, expected) => {
        expect(isTransactionControl(sql)).toBe(expected)
    })

    it('reads the leading keyword past comments and parentheses', () => {
        expect(leadingKeyword('-- c\n /* d */ (select 1)')).toBe('SELECT')
    })
})
