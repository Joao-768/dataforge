import Link from 'next/link'
import { ArrowRight, Check, KeyRound, Link2 } from 'lucide-react'
import { DemoButton } from '@/components/auth/demo-button'
import { Logo } from '@/components/logo'
import { ThemeToggle } from '@/components/theme-toggle'
import { buttonClass } from '@/components/ui/button'
import { highlightSql } from '@/components/sql-block'
import { currentUser } from '@/server/auth/session'

export const dynamic = 'force-dynamic'

// The sticky header is 57px tall (56px row + 1px rule).
const SCREEN = 'flex min-h-[calc(100svh-57px)] flex-col scroll-mt-[57px]'

// The tables of the demo database, as they appear on the canvas.
const DEMO_TABLES = [
    {
        name: 'users',
        x: 0,
        y: 46,
        columns: [
            ['id', 'bigint', 'pk'],
            ['email', 'varchar(254)', ''],
            ['full_name', 'varchar(120)', ''],
            ['country', 'char(2)', ''],
        ],
    },
    {
        name: 'orders',
        x: 236,
        y: 0,
        columns: [
            ['id', 'bigint', 'pk'],
            ['user_id', 'bigint', 'fk'],
            ['status', 'varchar(20)', ''],
            ['total', 'numeric(12,2)', ''],
            ['placed_at', 'timestamptz', ''],
        ],
    },
    {
        name: 'order_items',
        x: 472,
        y: 46,
        columns: [
            ['order_id', 'bigint', 'pk'],
            ['product_id', 'bigint', 'pk'],
            ['quantity', 'integer', ''],
            ['unit_price', 'numeric(10,2)', ''],
        ],
    },
    {
        name: 'payments',
        x: 236,
        y: 210,
        columns: [
            ['id', 'bigint', 'pk'],
            ['order_id', 'bigint', 'fk'],
            ['provider', 'varchar(20)', ''],
            ['metadata', 'jsonb', '?'],
        ],
    },
] as const

const MIGRATION = `-- Create table public.reviews with 4 columns
CREATE TABLE public.reviews (
    id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
    product_id bigint NOT NULL,
    rating smallint NOT NULL DEFAULT 5,
    body text,
    CONSTRAINT reviews_pkey PRIMARY KEY (id)
);

-- Link public.reviews to public.products
ALTER TABLE public.reviews ADD CONSTRAINT reviews_product_id_fkey
    FOREIGN KEY (product_id) REFERENCES public.products (id) ON DELETE CASCADE;`

function SchemaIllustration() {
    return (
        <div
            className="relative mx-auto hidden aspect-[700/380] w-full max-w-[700px] sm:block"
            aria-hidden="true"
        >
            <svg viewBox="0 0 700 380" className="absolute inset-0 h-full w-full">
                <defs>
                    <marker
                        id="lp-many"
                        viewBox="0 0 16 16"
                        refX="1"
                        refY="8"
                        markerWidth="14"
                        markerHeight="14"
                        orient="auto-start-reverse"
                    >
                        <path
                            d="M15 8 L1 1.5 M15 8 L1 8 M15 8 L1 14.5"
                            fill="none"
                            stroke="var(--edge-active)"
                            strokeWidth="1.3"
                        />
                    </marker>
                    <marker
                        id="lp-one"
                        viewBox="0 0 16 16"
                        refX="15"
                        refY="8"
                        markerWidth="14"
                        markerHeight="14"
                        orient="auto"
                    >
                        <path
                            d="M11 2 L11 14 M1 8 L15 8"
                            fill="none"
                            stroke="var(--edge-active)"
                            strokeWidth="1.3"
                        />
                    </marker>
                </defs>
                <path
                    d="M236 78 H212 V95 H200"
                    fill="none"
                    stroke="var(--edge-active)"
                    strokeWidth="1.3"
                    markerStart="url(#lp-many)"
                    markerEnd="url(#lp-one)"
                />
                <path
                    d="M472 95 H448 V57 H436"
                    fill="none"
                    stroke="var(--edge-active)"
                    strokeWidth="1.3"
                    markerStart="url(#lp-many)"
                    markerEnd="url(#lp-one)"
                />
                <path
                    d="M336 252 V160"
                    fill="none"
                    stroke="var(--accent)"
                    strokeWidth="1.6"
                    markerStart="url(#lp-many)"
                    markerEnd="url(#lp-one)"
                />
            </svg>
            {DEMO_TABLES.map((table) => (
                <div
                    key={table.name}
                    className="absolute w-[28.6%] rounded-md border border-rule-strong bg-panel text-[clamp(8px,1.05vw,11.5px)] shadow-xl shadow-black/20"
                    style={{ left: `${(table.x / 700) * 100}%`, top: `${(table.y / 380) * 100}%` }}
                >
                    <div
                        className={`flex items-center gap-1.5 border-b border-rule px-2 py-1.5 ${table.name === 'payments' ? 'bg-accent-soft' : 'bg-raised/60'}`}
                    >
                        <span className="h-1.5 w-1.5 rounded-[2px] bg-accent" />
                        <span className="font-mono font-semibold">{table.name}</span>
                    </div>
                    {table.columns.map(([name, type, kind]) => (
                        <div key={name} className="flex items-center gap-1.5 px-2 py-[3px]">
                            <span className="flex w-3 justify-center">
                                {kind === 'pk' ? (
                                    <KeyRound size={9} className="text-accent" />
                                ) : kind === 'fk' ? (
                                    <Link2 size={9} className="text-ink-2" />
                                ) : null}
                            </span>
                            <span className="flex-1 truncate font-mono text-ink-2">{name}</span>
                            <span className="truncate font-mono text-ink-3">
                                {type}
                                {kind === '?' ? '?' : ''}
                            </span>
                        </div>
                    ))}
                </div>
            ))}
        </div>
    )
}

export default async function LandingPage() {
    const user = await currentUser()
    return (
        <div className="min-h-svh">
            <header className="sticky top-0 z-40 border-b border-rule bg-paper/90 backdrop-blur">
                <div className="mx-auto flex h-14 max-w-[1240px] items-center gap-6 px-5">
                    <Link href="/" aria-label="DataForge home" className="rounded">
                        <Logo />
                    </Link>
                    <nav
                        aria-label="Sections"
                        className="hidden items-center gap-5 text-[13.5px] text-ink-3 md:flex"
                    >
                        <a href="#workflow" className="hover:text-ink">
                            Workflow
                        </a>
                        <a href="#engineering" className="hover:text-ink">
                            Under the hood
                        </a>
                    </nav>
                    <div className="ml-auto flex items-center gap-2">
                        <ThemeToggle />
                        {user ? (
                            <Link href="/projects" className={buttonClass('primary', 'sm')}>
                                Open your projects
                            </Link>
                        ) : (
                            <>
                                <Link href="/login" className={buttonClass('ghost', 'sm')}>
                                    Sign in
                                </Link>
                                <Link
                                    href="/register"
                                    className={buttonClass(
                                        'secondary',
                                        'sm',
                                        'hidden sm:inline-flex',
                                    )}
                                >
                                    Create account
                                </Link>
                            </>
                        )}
                    </div>
                </div>
            </header>

            <main>
                {/* 1. Hero */}
                <section className={`${SCREEN} blueprint border-b border-rule`}>
                    <div className="mx-auto grid w-full max-w-[1240px] flex-1 grid-rows-[auto_1fr_auto] gap-8 px-5 py-10">
                        <p className="eyebrow">Visual PostgreSQL studio</p>
                        <div className="grid items-center gap-12 lg:grid-cols-[1fr_1.2fr]">
                            <div>
                                <h1 className="text-[clamp(2.3rem,4.3vw,4rem)] leading-[1.04] font-semibold tracking-[-0.035em]">
                                    <span className="block whitespace-nowrap">
                                        Draw the schema.
                                    </span>
                                    <span className="block whitespace-nowrap text-ink-3">
                                        Ship the migration.
                                    </span>
                                </h1>
                                <p className="mt-6 max-w-[34rem] text-[clamp(1rem,1.3vw,1.15rem)] leading-relaxed text-ink-2">
                                    DataForge turns tables and relationships drawn on a canvas into
                                    reviewed, transactional SQL, then lets you query, explain and
                                    edit the result against a real PostgreSQL database.
                                </p>
                                <div className="mt-8 flex flex-wrap items-center gap-3">
                                    {user ? (
                                        <Link
                                            href="/projects"
                                            className={buttonClass('primary', 'lg')}
                                        >
                                            Open your projects <ArrowRight size={16} />
                                        </Link>
                                    ) : (
                                        <DemoButton />
                                    )}
                                    <Link
                                        href="/register"
                                        className={buttonClass('secondary', 'lg')}
                                    >
                                        Create a free account
                                    </Link>
                                </div>
                                <p className="mt-4 text-[13px] text-ink-3">
                                    The demo gives you a private copy of an e-commerce database.
                                    Break anything; it is yours alone.
                                </p>
                            </div>
                            <SchemaIllustration />
                        </div>
                        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-rule bg-rule md:grid-cols-4">
                            {[
                                ['Database', 'PostgreSQL 17, real and private'],
                                ['Demo data', '6 tables · 17,000+ rows'],
                                ['Migrations', 'One transaction per apply'],
                                ['Queries', 'Read-only unless you say so'],
                            ].map(([label, value]) => (
                                <div key={label} className="bg-panel px-4 py-3">
                                    <dt className="eyebrow">{label}</dt>
                                    <dd className="mt-1 text-[14px] font-medium">{value}</dd>
                                </div>
                            ))}
                        </dl>
                    </div>
                </section>

                {/* 2. Workflow */}
                <section id="workflow" className={`${SCREEN} border-b border-rule`}>
                    <div className="mx-auto grid w-full max-w-[1240px] flex-1 grid-rows-[auto_1fr] gap-8 px-5 py-12">
                        <div className="flex flex-wrap items-end justify-between gap-6">
                            <div>
                                <p className="eyebrow mb-3">Workflow</p>
                                <h2 className="max-w-[40rem] text-[clamp(1.8rem,3.4vw,2.9rem)] leading-[1.05] font-semibold tracking-[-0.03em]">
                                    From canvas to commit, every step shows its SQL.
                                </h2>
                            </div>
                            <p className="max-w-[26rem] text-[15px] text-ink-2">
                                The draft is diffed against the live catalog by object identity, so
                                a renamed column is a rename, not a drop and an add.
                            </p>
                        </div>
                        <ol className="grid gap-4 lg:grid-cols-[1fr_1.35fr_1fr]">
                            <li className="flex flex-col rounded-lg border border-rule bg-panel">
                                <p className="border-b border-rule px-4 py-3">
                                    <span className="font-mono text-[11px] text-accent">01</span>{' '}
                                    <span className="ml-2 text-[15px] font-medium">Design</span>
                                </p>
                                <div className="blueprint flex flex-1 flex-col justify-center gap-4 p-5">
                                    <p className="text-[clamp(14px,1.2vw,16px)] leading-relaxed text-ink-2">
                                        Add tables, set types, keys, defaults and identity columns.
                                        Drag a column onto another table&apos;s key to create a
                                        foreign key. Invalid references are flagged before any SQL
                                        exists.
                                    </p>
                                    <ul className="space-y-2 font-mono text-[clamp(12px,0.95vw,13.5px)]">
                                        {[
                                            'reviews.product_id → products.id',
                                            'ON DELETE CASCADE',
                                            'rating smallint NOT NULL DEFAULT 5',
                                        ].map((line) => (
                                            <li
                                                key={line}
                                                className="flex items-center gap-2 rounded border border-rule bg-paper px-2.5 py-1.5"
                                            >
                                                <Check size={12} className="text-ok" /> {line}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            </li>
                            <li className="flex flex-col rounded-lg border border-rule bg-panel">
                                <p className="border-b border-rule px-4 py-3">
                                    <span className="font-mono text-[11px] text-accent">02</span>{' '}
                                    <span className="ml-2 text-[15px] font-medium">
                                        Review the generated SQL
                                    </span>
                                </p>
                                <pre className="scrollbar-thin flex flex-1 items-center overflow-auto p-5 font-mono text-[clamp(12px,0.95vw,13.5px)] leading-[1.75]">
                                    <code>{highlightSql(MIGRATION)}</code>
                                </pre>
                            </li>
                            <li className="flex flex-col rounded-lg border border-rule bg-panel">
                                <p className="border-b border-rule px-4 py-3">
                                    <span className="font-mono text-[11px] text-accent">03</span>{' '}
                                    <span className="ml-2 text-[15px] font-medium">
                                        Apply, then query
                                    </span>
                                </p>
                                <div className="flex flex-1 flex-col justify-center gap-4 p-5">
                                    <ol className="space-y-1.5 font-mono text-[clamp(12px,0.95vw,13.5px)]">
                                        {[
                                            ['BEGIN', 'text-ink-2'],
                                            ['pg_current_xact_id() → 1042', 'text-ink-3'],
                                            ['step 1 of 2 · CREATE TABLE', 'text-ink-2'],
                                            ['step 2 of 2 · ADD CONSTRAINT', 'text-ink-2'],
                                            ['COMMIT', 'text-ok'],
                                            ['status → applied', 'text-accent'],
                                        ].map(([line, tone]) => (
                                            <li key={line} className={tone}>
                                                {line}
                                            </li>
                                        ))}
                                    </ol>
                                    <p className="text-[clamp(14px,1.2vw,16px)] leading-relaxed text-ink-2">
                                        A migration is marked applied only after COMMIT returns. If
                                        the app stops mid-apply, the recorded transaction id settles
                                        the outcome with pg_xact_status().
                                    </p>
                                </div>
                            </li>
                        </ol>
                    </div>
                </section>

                {/* 3. Engineering */}
                <section id="engineering" className={`${SCREEN} border-b border-rule`}>
                    <div className="mx-auto grid w-full max-w-[1240px] flex-1 grid-rows-[auto_1fr_auto] gap-8 px-5 py-12">
                        <div>
                            <p className="eyebrow mb-3">Under the hood</p>
                            <h2 className="max-w-[44rem] text-[clamp(1.8rem,3.4vw,2.9rem)] leading-[1.05] font-semibold tracking-[-0.03em]">
                                The database enforces the rules. The interface only explains them.
                            </h2>
                        </div>
                        <dl className="grid self-center gap-px overflow-hidden rounded-lg border border-rule bg-rule sm:grid-cols-2 lg:grid-cols-4">
                            {[
                                [
                                    'Read-only by role',
                                    'Reads run as a role that only has SELECT, inside READ ONLY transactions. Nobody guesses from the SQL text.',
                                ],
                                [
                                    'One statement per message',
                                    'User SQL goes through the extended query protocol, which refuses multi-statement strings.',
                                ],
                                [
                                    'A watchdog, not a hope',
                                    'statement_timeout first; then the server cancels and terminates the backend itself.',
                                ],
                                [
                                    'Clean connections',
                                    'DISCARD ALL before a connection returns to the pool. No SET or temp table leaks into the next run.',
                                ],
                                [
                                    'Private sandboxes',
                                    'Each project gets its own database and roles, with CONNECT revoked from everyone else.',
                                ],
                                [
                                    'Sealed credentials',
                                    'AES-256-GCM with the connection id as associated data. Passwords never reach the browser.',
                                ],
                                [
                                    'Exact diffs',
                                    'Tables and columns are identified by OID and attnum, so renames are detected, not guessed.',
                                ],
                                [
                                    'Streaming I/O',
                                    'CSV imports and exports stream through cursors and batched unnest() inserts with savepoints.',
                                ],
                            ].map(([title, text]) => (
                                <div
                                    key={title}
                                    className="flex flex-col bg-panel px-5 py-[clamp(1.25rem,3vh,2.25rem)]"
                                >
                                    <dt className="text-[clamp(15px,1.2vw,17px)] font-medium">
                                        {title}
                                    </dt>
                                    <dd className="mt-2 text-[clamp(13.5px,1.05vw,15px)] leading-relaxed text-ink-2">
                                        {text}
                                    </dd>
                                </div>
                            ))}
                        </dl>
                        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-t border-rule pt-5 md:grid-cols-4">
                            {[
                                ['App', 'Next.js 16 · React 19 · TypeScript'],
                                ['Database', 'PostgreSQL 17 · node-postgres · pg-cursor'],
                                ['Interface', 'React Flow · Monaco · TanStack Table'],
                                ['Runtime', 'Docker Compose · isolated networks'],
                            ].map(([label, value]) => (
                                <div key={label}>
                                    <dt className="eyebrow">{label}</dt>
                                    <dd className="mt-1 font-mono text-[12.5px] text-ink-2">
                                        {value}
                                    </dd>
                                </div>
                            ))}
                        </dl>
                    </div>
                </section>

                {/* 4. Closing statement */}
                <section className={`${SCREEN} blueprint`}>
                    <div className="mx-auto grid w-full max-w-[1240px] flex-1 grid-rows-[auto_1fr_auto] gap-8 px-5 py-12">
                        <p className="eyebrow">Try it</p>
                        <div className="grid content-center items-center gap-10 lg:grid-cols-[1.25fr_1fr]">
                            <h2 className="text-[clamp(2.6rem,6vw,5.4rem)] leading-[1] font-semibold tracking-[-0.04em]">
                                A real database is one click away.
                            </h2>
                            <div className="space-y-5">
                                <ul className="space-y-3 text-[clamp(15px,1.25vw,17px)] text-ink-2">
                                    {[
                                        'A private copy of an e-commerce database, created in under a second',
                                        'Six saved example queries, from window functions to JSONB',
                                        'Write mode, migrations and imports all work against your copy',
                                        'Removed automatically after a day',
                                    ].map((item) => (
                                        <li key={item} className="flex gap-2.5">
                                            <Check
                                                size={16}
                                                className="mt-1 shrink-0 text-accent"
                                            />{' '}
                                            {item}
                                        </li>
                                    ))}
                                </ul>
                                <div className="flex flex-wrap gap-3">
                                    {user ? (
                                        <Link
                                            href="/projects"
                                            className={buttonClass('primary', 'lg')}
                                        >
                                            Open your projects <ArrowRight size={16} />
                                        </Link>
                                    ) : (
                                        <DemoButton />
                                    )}
                                </div>
                            </div>
                        </div>
                        <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-rule pt-5 text-[12.5px] text-ink-3">
                            <Logo />
                            <span className="font-mono">
                                Next.js · TypeScript · PostgreSQL 17 · React Flow · Monaco · Docker
                            </span>
                        </footer>
                    </div>
                </section>
            </main>
        </div>
    )
}
