# Architecture

## Two kinds of database

DataForge never mixes its own data with the data it manages.

|             | Application database (`app-db`)                                                                                                                           | Target server (`target-db`)                                                                                            |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Holds       | Users, sessions, reset tokens, settings, projects, connections (encrypted credentials), schema drafts, migrations, saved queries, query history, activity | The demo template database and one database per sandbox                                                                |
| Accessed by | The app's own pool (`src/server/db/app-db.ts`)                                                                                                            | Per-sandbox roles through small per-role pools (`src/server/targets/pools.ts`), and the provisioner for administration |
| Schema      | `db/migrations/*.sql`, applied at startup with an advisory lock and checksums                                                                             | Whatever users design                                                                                                  |

External databases (when allowed) take the place of a sandbox; everything else is the same.

## Request path

```
browser ─► proxy.ts (CSP nonce, optimistic auth redirect)
        ─► route handler (src/app/api/**/route.ts)
             └─ authedRoute(): same-origin check → session → rate limit → zod validation
                  └─ service (src/server/**)
                       ├─ requireProject(userId, projectId)   ownership, 404 for others
                       ├─ projectTarget(..., 'read' | 'write') decrypts credentials, returns a pool
                       └─ withTargetTransaction(...)          the guarded harness
```

Pages are server components that verify the session (and project ownership for workspace pages) before rendering, then client components fetch through the API with TanStack Query.

## The guarded query harness

`src/server/query/session.ts` is the single path for user-visible SQL: SQL editor runs, EXPLAIN, explorer reads and writes, imports and exports.

1. Take a dedicated connection for the role the operation needs.
2. `BEGIN READ ONLY` (reads) or `BEGIN` (writes, EXPLAIN ANALYZE); `SET LOCAL statement_timeout`; take a snapshot and remember the transaction's start time.
3. Run each statement through a cursor (extended protocol, so one statement per message; at most `maxRows + 1` rows are fetched from the portal).
4. After each statement, check the transaction start time and `transaction_read_only`. If a statement ended or altered the transaction, stop.
5. Commit only in write mode and only if everything succeeded; otherwise roll back. EXPLAIN ANALYZE always rolls back.
6. A watchdog cancels the backend at timeout + 2 s and terminates it at timeout + 10 s.
7. `DISCARD ALL`, then return the connection to the pool (or destroy it if anything went wrong).

Running queries are registered by run id, so a user can cancel their own run (`pg_cancel_backend` via the provisioner for sandboxes, or a second connection with the same role for external databases).

## Schema model, diff and migrations

`src/shared/schema` holds one model used everywhere:

- **Introspection** (`src/server/schema/introspect.ts`) reads `pg_class`, `pg_attribute`, `pg_attrdef`, `pg_constraint` and `pg_index` into tables whose ids come from the catalog: `t<oid>`, `c<oid>.<attnum>`, `k<conoid>`. Designer-created objects get `n_` ids.
- **Validation** (`validate.ts`) checks names, types and their arguments, identity rules, keys, and foreign keys (target must be a primary key or unique, types must be compatible, `SET NULL` needs a nullable column), and guards default expressions against statement terminators and comments.
- **Diff** (`diff.ts`) matches objects by id and emits one statement per step in a dependency-safe order: drop changed foreign keys (and those depending on a rebuilt key), drop keys, drop tables, rename tables (through temporary names for swaps), column changes, create tables, add keys, add foreign keys, comments. Each step carries a summary, a destructive flag and a warning.
- **Draft** (`schema_drafts`) stores the designer document, the live schema it was based on and that schema's fingerprint. Diffing document against base tells whether the draft has changes; comparing the fingerprint with the live database tells whether the database moved. Saves use a revision number for optimistic concurrency.
- **Migration** freezes the diff and the base fingerprint. Applying re-checks the fingerprint, claims the row (`draft|failed → applying`), records `pg_current_xact_id()`, runs every step in one transaction with a lock timeout, and marks it `applied` only after COMMIT returns. A failure rolls back and records the failing step. If the app dies mid-apply, `pg_xact_status(xid)` later settles the row as applied or failed.

## Sandboxes

`src/server/targets/provisioner.ts`:

- The demo template (`df_template_ecommerce`) is built from `db/demo/ecommerce.sql` under a `NOLOGIN` owner role. A checksum stored as the database comment rebuilds it when the seed changes.
- A sandbox is `CREATE DATABASE df_<12 hex> TEMPLATE …`, `REVOKE ALL … FROM PUBLIC`, two login roles (`_owner`, `_ro`) with connection limits and timeouts, `REASSIGN OWNED` from the template owner, and `SELECT` plus default privileges for the read role. About 0.5 to 1 s for the demo dataset.
- Dropping is `DROP DATABASE … WITH (FORCE)` and `DROP ROLE` for both roles.

## Frontend

- Next.js App Router, React 19, Tailwind CSS v4 (design tokens as CSS variables, dark by default, `data-theme` set before paint by `public/theme.js`).
- Designer: React Flow with custom table nodes (a handle per column side) and crow's-foot edges, a Zustand store with snapshot undo/redo, pure edit operations (`operations.ts`, unit-tested), dagre layout, debounced autosave.
- SQL editor: Monaco served from `/monaco/vs` (copied from the npm package, no CDN), a completion provider fed by live introspection, per-project tabs persisted to localStorage.
- Grids: TanStack Table for the column model and TanStack Virtual for rows.
- Resizable panels (react-resizable-panels) remember their layout per area.

## Operations

- Structured JSON logs (pino) with redaction of credentials, SQL text, bind values and rows.
- `src/instrumentation.ts` runs migrations, prepares the demo template and starts a 10-minute housekeeping sweep (expired guests, expired sessions and tokens, orphaned sandboxes).
- Health check: `GET /api/health` queries the application database.
