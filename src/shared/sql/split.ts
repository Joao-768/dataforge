// Splits a SQL script into statements the way PostgreSQL's lexer sees them:
// semicolons inside string literals, quoted identifiers, dollar-quoted bodies
// and (nested) comments do not end a statement.
//
// Splitting is a usability feature (run the statement under the cursor, run
// a script one statement at a time, report which statement failed), not a
// security boundary: the server additionally executes each statement through
// the extended query protocol, which rejects multi-statement strings.

export interface SqlStatement {
    /** Statement text without the trailing semicolon, trimmed. */
    text: string
    /** Offset of the first non-blank character in the original script. */
    start: number
    /** Offset just past the statement's last character (before `;`). */
    end: number
}

const DOLLAR_TAG = /^\$([A-Za-z_\u0080-￿][A-Za-z0-9_\u0080-￿]*)?\$/

export function splitStatements(script: string): SqlStatement[] {
    const statements: SqlStatement[] = []
    let start = 0
    let i = 0
    const length = script.length

    const push = (end: number) => {
        const raw = script.slice(start, end)
        if (hasCode(raw)) {
            const leading = raw.length - raw.trimStart().length
            const trailing = raw.length - raw.trimEnd().length
            statements.push({
                text: raw.trim(),
                start: start + leading,
                end: end - trailing,
            })
        }
    }

    while (i < length) {
        const char = script[i]!
        const next = script[i + 1]

        if (char === '-' && next === '-') {
            i = skipLineComment(script, i)
            continue
        }
        if (char === '/' && next === '*') {
            i = skipBlockComment(script, i)
            continue
        }
        if (char === "'") {
            const escapes =
                i > 0 && /[eE]/.test(script[i - 1]!) && !/[A-Za-z0-9_]/.test(script[i - 2] ?? '')
            i = skipQuoted(script, i, "'", escapes)
            continue
        }
        if (char === '"') {
            i = skipQuoted(script, i, '"', false)
            continue
        }
        if (char === '$') {
            // A dollar quote cannot directly follow an identifier character
            // ($1 parameters and names like a$b are not quotes).
            const prev = script[i - 1] ?? ''
            const match = /[A-Za-z0-9_]/.test(prev) ? null : DOLLAR_TAG.exec(script.slice(i))
            if (match) {
                const tag = match[0]
                const close = script.indexOf(tag, i + tag.length)
                i = close === -1 ? length : close + tag.length
                continue
            }
        }
        if (char === ';') {
            push(i)
            start = i + 1
        }
        i += 1
    }
    push(length)
    return statements
}

function skipLineComment(script: string, i: number): number {
    const newline = script.indexOf('\n', i)
    return newline === -1 ? script.length : newline + 1
}

function skipBlockComment(script: string, i: number): number {
    // PostgreSQL block comments nest.
    let depth = 0
    while (i < script.length) {
        if (script[i] === '/' && script[i + 1] === '*') {
            depth += 1
            i += 2
        } else if (script[i] === '*' && script[i + 1] === '/') {
            depth -= 1
            i += 2
            if (depth === 0) return i
        } else {
            i += 1
        }
    }
    return script.length
}

function skipQuoted(script: string, i: number, quote: string, backslashEscapes: boolean): number {
    i += 1
    while (i < script.length) {
        const char = script[i]
        if (backslashEscapes && char === '\\') {
            i += 2
            continue
        }
        if (char === quote) {
            if (script[i + 1] === quote) {
                i += 2
                continue
            }
            return i + 1
        }
        i += 1
    }
    return script.length
}

/** True when `text` contains anything other than whitespace and comments. */
export function hasCode(text: string): boolean {
    let i = 0
    while (i < text.length) {
        const char = text[i]!
        if (/\s/.test(char)) {
            i += 1
        } else if (char === '-' && text[i + 1] === '-') {
            i = skipLineComment(text, i)
        } else if (char === '/' && text[i + 1] === '*') {
            i = skipBlockComment(text, i)
        } else {
            return true
        }
    }
    return false
}

/** The statement containing (or nearest before) `offset`, for "run at cursor". */
export function statementAt(script: string, offset: number): SqlStatement | null {
    const statements = splitStatements(script)
    let candidate: SqlStatement | null = null
    for (const statement of statements) {
        if (offset >= statement.start && offset <= statement.end + 1) return statement
        if (statement.start <= offset) candidate = statement
    }
    return candidate ?? statements[0] ?? null
}

/** First keyword of a statement, upper-cased, skipping comments and parentheses. */
export function leadingKeyword(statement: string): string {
    let i = 0
    while (i < statement.length) {
        const char = statement[i]!
        if (/\s|\(/.test(char)) {
            i += 1
        } else if (char === '-' && statement[i + 1] === '-') {
            i = skipLineComment(statement, i)
        } else if (char === '/' && statement[i + 1] === '*') {
            i = skipBlockComment(statement, i)
        } else {
            break
        }
    }
    const match = /^[A-Za-z_]+/.exec(statement.slice(i))
    return match ? match[0].toUpperCase() : ''
}

const TRANSACTION_CONTROL = new Set([
    'BEGIN',
    'START',
    'COMMIT',
    'END',
    'ROLLBACK',
    'ABORT',
    'SAVEPOINT',
    'RELEASE',
    'PREPARE',
])

/**
 * Statements that would end or reshape the transaction DataForge wraps every
 * run in. Rejected up front for a clear message; the executor also verifies
 * after each statement that its transaction is still the one in effect.
 */
export function isTransactionControl(statement: string): boolean {
    const keyword = leadingKeyword(statement)
    if (keyword === 'PREPARE') return /^\s*prepare\s+transaction\b/i.test(statement)
    if (keyword === 'SET' || keyword === 'RESET') {
        return /\b(transaction|session\s+characteristics|default_transaction_read_only|transaction_read_only)\b/i.test(
            statement,
        )
    }
    return TRANSACTION_CONTROL.has(keyword)
}
