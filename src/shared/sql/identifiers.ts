// Identifier and literal quoting for SQL that DataForge generates.
//
// Identifiers are emitted bare only when PostgreSQL would read them back
// unchanged (lower-case, not a keyword); anything else is double-quoted with
// embedded quotes doubled, matching quote_ident(). User-supplied values never
// go through these helpers on the way to the database: they are sent as bind
// parameters. Literals are only quoted for display and generated scripts.

// Keywords that cannot be used as bare identifiers in every position:
// PostgreSQL's reserved, type/function-name and column-name keyword groups.
const KEYWORDS = new Set(
    `all analyse analyze and any array as asc asymmetric authorization between bigint binary bit
    boolean both case cast char character check coalesce collate collation column concurrently
    constraint create cross current_catalog current_date current_role current_schema current_time
    current_timestamp current_user dec decimal default deferrable desc distinct do else end except
    exists extract false fetch float for foreign freeze from full grant greatest group grouping
    having ilike in initially inner inout int integer intersect interval into is isnull join
    json json_array json_arrayagg json_exists json_object json_objectagg json_query json_scalar
    json_serialize json_table json_value lateral leading least left like limit localtime
    localtimestamp merge_action national natural nchar none normalize not notnull null nullif
    numeric offset on only or order out outer overlaps overlay placing position precision primary
    real references returning right row select session_user setof similar smallint some substring
    symmetric system_user table tablesample then time timestamp to trailing treat trim true union
    unique user using values varchar variadic verbose when where window with xmlattributes
    xmlconcat xmlelement xmlexists xmlforest xmlnamespaces xmlparse xmlpi xmlroot xmlserialize
    xmltable`
        .split(/\s+/)
        .filter(Boolean),
)

const BARE = /^[a-z_][a-z0-9_$]*$/

/** Maximum identifier length in bytes (NAMEDATALEN - 1). */
export const MAX_IDENTIFIER_BYTES = 63

export function quoteIdent(name: string): string {
    if (BARE.test(name) && !KEYWORDS.has(name)) return name
    return `"${name.replaceAll('"', '""')}"`
}

/** Schema-qualified name; every generated statement is qualified. */
export function qualify(schema: string, name: string): string {
    return `${quoteIdent(schema)}.${quoteIdent(name)}`
}

export function quoteLiteral(value: string): string {
    // Standard-conforming strings are on by default, so only quotes need
    // doubling; backslashes force the E'' form to stay unambiguous.
    if (value.includes('\\')) {
        return `E'${value.replaceAll('\\', '\\\\').replaceAll("'", "''")}'`
    }
    return `'${value.replaceAll("'", "''")}'`
}

export function identifierBytes(name: string): number {
    return new TextEncoder().encode(name).length
}

export function isKeyword(name: string): boolean {
    return KEYWORDS.has(name.toLowerCase())
}
