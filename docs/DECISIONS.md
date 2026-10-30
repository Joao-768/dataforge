# Technical decisions

Short records of the choices that shaped DataForge, with the alternatives considered.

## Next.js App Router as a single service

The sibling projects use Vite with a separate Express server. DataForge uses one Next.js 16 application: pages and API route handlers deploy as one container, server components check sessions and ownership before rendering, and the API is still a conventional JSON API used by the client. The cost is coupling the API to Next's runtime; the gain is one build, one image and one place to enforce auth.

## node-postgres with SQL, not an ORM

The application schema is small and the project is about PostgreSQL, so queries are hand-written SQL through `pg`, with forward-only migration files checked by checksum and serialised with an advisory lock. Target databases need low-level control an ORM does not offer: the extended protocol, portals with row limits (`pg-cursor`), per-role pools, custom type parsing, cancellation by backend pid.

## Two PostgreSQL servers

Application metadata and user databases live on separate servers. User SQL can exhaust connections, memory or disk on the target server without affecting accounts, sessions or migration records.

## Sandboxes as databases with dedicated roles

Alternatives were schemas per user in one database (weaker isolation: shared catalogs, `PUBLIC` privileges, harder cleanup) and a container per user (heavy, slow, and exactly the "containers from untrusted input" pattern to avoid). A database per sandbox with its own owner and read-only roles gives PostgreSQL-enforced isolation, sub-second creation by template cloning, and `DROP DATABASE … WITH (FORCE)` cleanup. The provisioner role has `CREATEDB` and `CREATEROLE` but is not a superuser; PostgreSQL 16+'s `createrole_self_grant` lets it act as the roles it creates.

## Read-only by role and transaction, not by parsing

Classifying SQL text is unreliable (CTEs with DML, functions with side effects, `SELECT … FOR UPDATE`, procedures). DataForge lets PostgreSQL decide: a role without write privileges, a READ ONLY transaction with an early snapshot, and a post-statement check. Text inspection is used only to give a clearer message for transaction-control statements.

## Identity-based schema diffing

Diffing by name cannot tell a rename from a drop and an add, which is the most dangerous mistake a migration tool can make. Introspected objects carry ids derived from OID and attnum, so the designer's edits keep identity and the diff emits `RENAME`. New objects get `n_` ids and are rebased onto real ids after the migration is applied.

## Migrations: one transaction, outcome from PostgreSQL

All supported operations are transactional DDL, so each migration is a single transaction with a lock timeout. Status changes come from what the database confirms: `applied` after COMMIT, `failed` after rollback, and `pg_xact_status()` for runs interrupted between COMMIT and the status update. Destructive steps (dropping, narrowing types) need typed confirmation. No automatic down-migrations are promised, because dropped data cannot be restored by rolling forward.

## Monaco served from the app

`@monaco-editor/react` loads Monaco from a CDN by default. DataForge copies Monaco's prebuilt bundle into `public/monaco` at install time and serves it from its own origin, which keeps the CSP to `'self'` plus nonces and works offline.

## In-memory rate limits and run registry

Fixed-window counters and the map of running queries live in process memory. That is correct for the single-instance deployment this project targets and avoids a Redis dependency. Moving to multiple instances needs a shared store; documented as a limitation.

## Testcontainers for integration tests

Integration tests start a real PostgreSQL 17 container and initialise it exactly like production (provisioner role, revoked CONNECT), so they test the actual privilege boundaries rather than mocks of them. Files share one container and run sequentially.

## Visual identity

DataForge follows the shared language of the portfolio: neutral ink and paper tokens per theme with dark as the default, hairline rules, uppercase mono labels, status colours reserved for state, the native-dialog and toast patterns from PulseMonitor and the React Flow canvas conventions from Workflow Engine. Like PulseMonitor, it is black and white: what is active, selected or focused is marked in the strong ink, and the only hues are functional (status, and syntax highlighting with CollabCode's palette).
