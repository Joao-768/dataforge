// PostgreSQL column types as the designer understands them.
//
// Types are stored as normalised strings ("varchar(120)", "numeric(10,2)",
// "timestamptz", "text[]"). normalizeType() turns format_type() output into
// that form; parseType() splits it for validation and the type picker.

export interface TypeInfo {
    /** Canonical short name used in the model. */
    name: string
    label: string
    family: TypeFamily
    /** Arguments the type accepts, e.g. varchar(length) or numeric(p, s). */
    args?: 'length' | 'precision-scale' | 'fractional-seconds'
    /** Whether identity (auto-increment) is allowed. */
    identity?: boolean
    description: string
}

export type TypeFamily =
    | 'integer'
    | 'decimal'
    | 'float'
    | 'text'
    | 'boolean'
    | 'datetime'
    | 'uuid'
    | 'json'
    | 'binary'
    | 'other'

export const DESIGNER_TYPES: TypeInfo[] = [
    {
        name: 'integer',
        label: 'integer',
        family: 'integer',
        identity: true,
        description: '4-byte whole number',
    },
    {
        name: 'bigint',
        label: 'bigint',
        family: 'integer',
        identity: true,
        description: '8-byte whole number',
    },
    {
        name: 'smallint',
        label: 'smallint',
        family: 'integer',
        identity: true,
        description: '2-byte whole number',
    },
    {
        name: 'numeric',
        label: 'numeric',
        family: 'decimal',
        args: 'precision-scale',
        description: 'Exact decimal, e.g. money',
    },
    { name: 'real', label: 'real', family: 'float', description: '4-byte floating point' },
    {
        name: 'double precision',
        label: 'double precision',
        family: 'float',
        description: '8-byte floating point',
    },
    { name: 'text', label: 'text', family: 'text', description: 'Variable-length text' },
    {
        name: 'varchar',
        label: 'varchar',
        family: 'text',
        args: 'length',
        description: 'Text with a length limit',
    },
    {
        name: 'char',
        label: 'char',
        family: 'text',
        args: 'length',
        description: 'Fixed-length text',
    },
    { name: 'boolean', label: 'boolean', family: 'boolean', description: 'true / false' },
    { name: 'date', label: 'date', family: 'datetime', description: 'Calendar date' },
    {
        name: 'time',
        label: 'time',
        family: 'datetime',
        args: 'fractional-seconds',
        description: 'Time of day',
    },
    {
        name: 'timestamp',
        label: 'timestamp',
        family: 'datetime',
        args: 'fractional-seconds',
        description: 'Date and time, no time zone',
    },
    {
        name: 'timestamptz',
        label: 'timestamptz',
        family: 'datetime',
        args: 'fractional-seconds',
        description: 'Date and time with time zone',
    },
    { name: 'interval', label: 'interval', family: 'datetime', description: 'Time span' },
    { name: 'uuid', label: 'uuid', family: 'uuid', description: '128-bit identifier' },
    { name: 'jsonb', label: 'jsonb', family: 'json', description: 'Binary JSON document' },
    { name: 'json', label: 'json', family: 'json', description: 'JSON text, kept as written' },
    { name: 'bytea', label: 'bytea', family: 'binary', description: 'Binary data' },
]

const BY_NAME = new Map(DESIGNER_TYPES.map((type) => [type.name, type]))

const ALIASES: [RegExp, string][] = [
    [/^character varying/, 'varchar'],
    [/^character(?=\(|$)/, 'char'],
    [/^bpchar/, 'char'],
    [/^int4$|^int$/, 'integer'],
    [/^int8$/, 'bigint'],
    [/^int2$/, 'smallint'],
    [/^float8$/, 'double precision'],
    [/^float4$/, 'real'],
    [/^bool$/, 'boolean'],
    [/^decimal/, 'numeric'],
]

/**
 * Normalises a type as printed by format_type() (or typed by a user) into the
 * model's canonical form.
 */
export function normalizeType(raw: string): string {
    const trimmed = raw.trim().replace(/\s+/g, ' ')
    // Quoted names (custom types such as "OrderStatus") are case-sensitive.
    if (trimmed.includes('"')) return trimmed
    let type = trimmed.toLowerCase()
    let array = ''
    while (type.endsWith('[]')) {
        array += '[]'
        type = type.slice(0, -2).trim()
    }
    // timestamp(3) with time zone -> timestamptz(3)
    const withTz = /^(timestamp|time)(\(\d+\))? with time zone$/.exec(type)
    if (withTz) {
        type = `${withTz[1] === 'timestamp' ? 'timestamptz' : 'timetz'}${withTz[2] ?? ''}`
    }
    const withoutTz = /^(timestamp|time)(\(\d+\))? without time zone$/.exec(type)
    if (withoutTz) type = `${withoutTz[1]}${withoutTz[2] ?? ''}`
    for (const [pattern, replacement] of ALIASES) {
        if (pattern.test(type)) {
            type = type.replace(pattern, replacement)
            break
        }
    }
    type = type.replace(/\(\s*(\d+)\s*,\s*(\d+)\s*\)/, '($1,$2)').replace(/\(\s*(\d+)\s*\)/, '($1)')
    return type + array
}

export interface ParsedType {
    base: string
    args: number[]
    array: boolean
    info: TypeInfo | undefined
}

export function parseType(type: string): ParsedType {
    const normalized = normalizeType(type)
    const array = normalized.endsWith('[]')
    const bare = normalized.replace(/(\[\])+$/, '')
    const match = /^([a-z_][a-z0-9_ ."]*?)(?:\((\d+)(?:,(\d+))?\))?$/.exec(bare)
    const base = match?.[1] ?? bare
    const args = [match?.[2], match?.[3]].filter((value) => value !== undefined).map(Number)
    return { base, args, array, info: BY_NAME.get(base) }
}

export function typeInfo(type: string): TypeInfo | undefined {
    return parseType(type).info
}

export function typeFamily(type: string): TypeFamily {
    const parsed = parseType(type)
    return parsed.array ? 'other' : (parsed.info?.family ?? 'other')
}

/** Problem with a type string, or null when it is valid for the designer. */
export function typeProblem(type: string): string | null {
    const { base, args, info } = parseType(type)
    if (!info) return null // Custom or extension types are passed through.
    if (args.length > 0 && !info.args) return `${base} does not take arguments`
    if (info.args === 'length' && args.length > 0) {
        if (args.length > 1) return `${base} takes a single length`
        if (args[0]! < 1 || args[0]! > 10_485_760)
            return `${base} length must be between 1 and 10485760`
    }
    if (info.args === 'precision-scale' && args.length > 0) {
        const [precision, scale = 0] = args
        if (precision! < 1 || precision! > 1000)
            return 'numeric precision must be between 1 and 1000'
        if (scale < 0 || scale > precision!)
            return 'numeric scale must be between 0 and the precision'
    }
    if (info.args === 'fractional-seconds' && args.length > 0) {
        if (args.length > 1 || args[0]! > 6) return `${base} precision must be between 0 and 6`
    }
    return null
}

/**
 * Whether a foreign key from `from` to `to` can be created. PostgreSQL needs
 * an equality operator between the types; within these families one exists.
 */
export function keyTypesCompatible(
    from: string,
    to: string,
): 'same' | 'compatible' | 'incompatible' {
    const a = normalizeType(from)
    const b = normalizeType(to)
    if (a === b) return 'same'
    const pa = parseType(a)
    const pb = parseType(b)
    if (pa.array !== pb.array) return 'incompatible'
    if (pa.base === pb.base) return 'compatible' // e.g. varchar(10) -> varchar(40)
    const fa = typeFamily(a)
    const fb = typeFamily(b)
    if (fa === fb && (fa === 'integer' || fa === 'text' || fa === 'datetime')) return 'compatible'
    return 'incompatible'
}

/** Suggested default expressions for a type, for the inspector's quick picks. */
export function defaultSuggestions(type: string): string[] {
    switch (typeFamily(type)) {
        case 'integer':
        case 'decimal':
        case 'float':
            return ['0']
        case 'boolean':
            return ['false', 'true']
        case 'text':
            return ["''"]
        case 'datetime': {
            const base = parseType(type).base
            if (base === 'date') return ['CURRENT_DATE']
            if (base === 'interval') return ["'0'::interval"]
            return ['now()']
        }
        case 'uuid':
            return ['gen_random_uuid()']
        case 'json':
            return ["'{}'::jsonb", "'[]'::jsonb"]
        default:
            return []
    }
}
