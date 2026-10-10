import { Fragment } from 'react'
import { cn } from '@/lib/utils'

// Lightweight SQL highlighting for read-only blocks (migration previews,
// history). The editor itself uses Monaco.

const KEYWORDS = new Set(
    `add all alter and as asc by cascade check column comment constraint create default delete desc distinct drop exists
    foreign from generated group having identity if in index insert into is join key left limit not null on or order
    primary references rename restrict returning select set table to type unique update using values where with always
    action no begin commit rollback view explain analyze over partition window case when then else end union`
        .split(/\s+/)
        .filter(Boolean),
)

const TOKEN =
    /(--[^\n]*)|('(?:[^']|'')*')|("(?:[^"]|"")*")|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_]*)|(\s+)|(.)/g

export function highlightSql(sql: string) {
    const parts: React.ReactNode[] = []
    let match: RegExpExecArray | null
    let index = 0
    TOKEN.lastIndex = 0
    while ((match = TOKEN.exec(sql))) {
        const [text, comment, string, , number, word] = match
        const key = index++
        if (comment)
            parts.push(
                <span key={key} style={{ color: 'var(--syntax-comment)' }}>
                    {text}
                </span>,
            )
        else if (string)
            parts.push(
                <span key={key} style={{ color: 'var(--syntax-string)' }}>
                    {text}
                </span>,
            )
        else if (number)
            parts.push(
                <span key={key} style={{ color: 'var(--syntax-number)' }}>
                    {text}
                </span>,
            )
        else if (word && KEYWORDS.has(word.toLowerCase()))
            parts.push(
                <span key={key} style={{ color: 'var(--syntax-keyword)' }}>
                    {text}
                </span>,
            )
        else parts.push(<Fragment key={key}>{text}</Fragment>)
    }
    return parts
}

export function SqlBlock({ sql, className }: { sql: string; className?: string }) {
    return (
        <pre
            className={cn(
                'scrollbar-thin overflow-auto rounded-md border border-rule bg-paper p-3 font-mono text-[12px] leading-[1.6] text-ink',
                className,
            )}
        >
            <code>{highlightSql(sql)}</code>
        </pre>
    )
}
