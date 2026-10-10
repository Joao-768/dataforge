import { describe, expect, it } from 'vitest'
import { keyTypesCompatible, normalizeType, parseType, typeProblem } from '@/shared/schema/types'
import { isSafeTypeChange } from '@/shared/schema/diff'

describe('normalizeType', () => {
    it.each([
        ['character varying(254)', 'varchar(254)'],
        ['character(2)', 'char(2)'],
        ['timestamp with time zone', 'timestamptz'],
        ['timestamp(3) without time zone', 'timestamp(3)'],
        ['numeric(10, 2)', 'numeric(10,2)'],
        ['integer[]', 'integer[]'],
        ['INT8', 'bigint'],
        ['"MyEnum"', '"MyEnum"'],
    ])('%s -> %s', (input, output) => {
        expect(normalizeType(input)).toBe(output)
    })
})

describe('parseType and typeProblem', () => {
    it('parses arguments and arrays', () => {
        expect(parseType('numeric(12,2)[]')).toMatchObject({
            base: 'numeric',
            args: [12, 2],
            array: true,
        })
    })
    it('validates arguments', () => {
        expect(typeProblem('varchar(0)')).toMatch(/length/)
        expect(typeProblem('numeric(5,7)')).toMatch(/scale/)
        expect(typeProblem('integer(4)')).toMatch(/does not take/)
        expect(typeProblem('varchar(120)')).toBeNull()
        expect(typeProblem('citext')).toBeNull()
    })
})

describe('keyTypesCompatible', () => {
    it('distinguishes same, compatible and incompatible', () => {
        expect(keyTypesCompatible('bigint', 'bigint')).toBe('same')
        expect(keyTypesCompatible('integer', 'bigint')).toBe('compatible')
        expect(keyTypesCompatible('varchar(10)', 'text')).toBe('compatible')
        expect(keyTypesCompatible('uuid', 'bigint')).toBe('incompatible')
        expect(keyTypesCompatible('integer[]', 'integer')).toBe('incompatible')
    })
})

describe('isSafeTypeChange', () => {
    it('accepts widenings and rejects narrowings', () => {
        expect(isSafeTypeChange('integer', 'bigint')).toBe(true)
        expect(isSafeTypeChange('bigint', 'integer')).toBe(false)
        expect(isSafeTypeChange('varchar(50)', 'varchar(100)')).toBe(true)
        expect(isSafeTypeChange('varchar(100)', 'varchar(50)')).toBe(false)
        expect(isSafeTypeChange('varchar(50)', 'text')).toBe(true)
        expect(isSafeTypeChange('numeric(10,2)', 'numeric(12,2)')).toBe(true)
        expect(isSafeTypeChange('numeric(10,2)', 'numeric(10,4)')).toBe(false)
        expect(isSafeTypeChange('text', 'integer')).toBe(false)
    })
})
