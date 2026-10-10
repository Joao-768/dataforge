import 'server-only'
import type pg from 'pg'

// Turning PostgreSQL result values into JSON for the browser, and naming
// result column types.

const TYPE_NAMES: Record<number, string> = {
    16: 'boolean',
    17: 'bytea',
    18: 'char',
    19: 'name',
    20: 'bigint',
    21: 'smallint',
    23: 'integer',
    25: 'text',
    26: 'oid',
    114: 'json',
    142: 'xml',
    650: 'cidr',
    700: 'real',
    701: 'double precision',
    790: 'money',
    829: 'macaddr',
    869: 'inet',
    1042: 'char',
    1043: 'varchar',
    1082: 'date',
    1083: 'time',
    1114: 'timestamp',
    1184: 'timestamptz',
    1186: 'interval',
    1266: 'timetz',
    1560: 'bit',
    1562: 'varbit',
    1700: 'numeric',
    2950: 'uuid',
    3614: 'tsvector',
    3802: 'jsonb',
    1000: 'boolean[]',
    1005: 'smallint[]',
    1007: 'integer[]',
    1016: 'bigint[]',
    1009: 'text[]',
    1015: 'varchar[]',
    1021: 'real[]',
    1022: 'double precision[]',
    1231: 'numeric[]',
    2951: 'uuid[]',
    3807: 'jsonb[]',
    199: 'json[]',
    1182: 'date[]',
    1115: 'timestamp[]',
    1185: 'timestamptz[]',
    2278: 'void',
    705: 'unknown',
}

export async function typeNames(
    client: Pick<pg.ClientBase, 'query'>,
    oids: number[],
): Promise<Map<number, string>> {
    const names = new Map<number, string>()
    const unknown: number[] = []
    for (const oid of oids) {
        const known = TYPE_NAMES[oid]
        if (known) names.set(oid, known)
        else unknown.push(oid)
    }
    if (unknown.length > 0) {
        const result = await client.query<{ oid: number; name: string }>(
            'SELECT oid::int AS oid, format_type(oid, NULL) AS name FROM pg_type WHERE oid = ANY($1::oid[])',
            [unknown],
        )
        for (const row of result.rows) names.set(row.oid, row.name)
    }
    return names
}

const MAX_CELL_LENGTH = 20_000

export function toJsonValue(value: unknown): unknown {
    if (value === null || value === undefined) return null
    if (typeof value === 'string') {
        return value.length > MAX_CELL_LENGTH
            ? `${value.slice(0, MAX_CELL_LENGTH)}… [truncated]`
            : value
    }
    if (value instanceof Date) return value.toISOString()
    if (Buffer.isBuffer(value)) return `\\x${value.toString('hex').slice(0, MAX_CELL_LENGTH)}`
    if (Array.isArray(value)) return value.map(toJsonValue)
    return value
}

export function toJsonRows(rows: unknown[][]): unknown[][] {
    return rows.map((row) => row.map(toJsonValue))
}
