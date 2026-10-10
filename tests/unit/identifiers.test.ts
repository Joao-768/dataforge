import { describe, expect, it } from 'vitest'
import { identifierBytes, qualify, quoteIdent, quoteLiteral } from '@/shared/sql/identifiers'

describe('quoteIdent', () => {
    it('leaves plain lower-case names bare', () => {
        expect(quoteIdent('order_items')).toBe('order_items')
    })
    it('quotes keywords, upper case, spaces and leading digits', () => {
        expect(quoteIdent('user')).toBe('"user"')
        expect(quoteIdent('order')).toBe('"order"')
        expect(quoteIdent('CamelCase')).toBe('"CamelCase"')
        expect(quoteIdent('with space')).toBe('"with space"')
        expect(quoteIdent('1st')).toBe('"1st"')
    })
    it('doubles embedded quotes so names cannot break out', () => {
        expect(quoteIdent('a"; drop table x; --')).toBe('"a""; drop table x; --"')
    })
    it('qualifies with the schema', () => {
        expect(qualify('public', 'user')).toBe('public."user"')
    })
})

describe('quoteLiteral', () => {
    it('doubles single quotes', () => {
        expect(quoteLiteral("it's")).toBe("'it''s'")
    })
    it('uses E-strings when backslashes are present', () => {
        expect(quoteLiteral('a\\b')).toBe("E'a\\\\b'")
    })
})

it('counts identifier length in bytes', () => {
    expect(identifierBytes('é')).toBe(2)
})
