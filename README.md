# DataForge

**A visual PostgreSQL studio.** Design a schema on a canvas, review the SQL it generates, apply it as a transactional migration, then query, explain, explore and import data, all against a real PostgreSQL database.

DataForge is the fourth project in a portfolio alongside CollabCode, Pulse Monitor and Workflow Automation Engine, and shares their visual language: ink on a pure background, hairline rules, uppercase mono labels and, like Pulse Monitor, a black-and-white interface where colour is reserved for status and code.

![Stack](https://img.shields.io/badge/Next.js-16-black) ![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17-336791) ![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)

---

## Contents

- [What it does](#what-it-does)
- [Quick start](#quick-start)
- [Local development](#local-development)
- [Architecture](#architecture)
- [Security model](#security-model)
- [Demo mode](#demo-mode)
- [Testing](#testing)
- [Environment variables](#environment-variables)
- [Deployment](#deployment)
- [Known limitations](#known-limitations)
- [Future improvements](#future-improvements)

Deeper documentation lives in [`docs/`](docs): [architecture](docs/ARCHITECTURE.md), [security](docs/SECURITY.md), [technical decisions](docs/DECISIONS.md) and a [demo walkthrough](docs/DEMO.md).

---

## What it does

| Area                | What is real about it                                                                                                                                                                                                                                                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Projects**        | Each project owns one PostgreSQL database, its schema draft, migrations, saved queries, history and activity feed. Rename, describe, delete (typed confirmation).                                                                                                                                                                                                        |
| **Databases**       | One click creates a private sandbox database (empty, or with an e-commerce sample) on an isolated PostgreSQL server, with its own owner and read-only roles. External PostgreSQL connections work when the deployment allowlists hosts; they are disabled by default.                                                                                                    |
| **Schema designer** | React Flow canvas of tables, columns, primary keys, unique constraints and foreign keys drawn with crow's-foot notation. Drag a column onto a key to create a relationship. Inspector for types, nullability, defaults, identity, comments and referential actions. Undo/redo, auto-layout (dagre), fit view, persisted positions, autosave with optimistic concurrency. |
| **Migrations**      | The draft is diffed against the live catalog by object identity (table OID, column attnum), so renames are renames. Ordered, one-statement-per-step DDL with destructive steps flagged. Applied in one transaction; marked applied only after COMMIT; interrupted runs settled with `pg_xact_status()`. Stale drafts and stale migrations are refused.                   |
| **SQL editor**      | Monaco with PostgreSQL highlighting, schema-aware completion (tables, aliased columns), tabs persisted per project, formatting, saved queries, history, keyboard shortcuts, cancellation. Read-only by default; write mode is an explicit, confirmed switch. Error markers at the exact position PostgreSQL reports.                                                     |
| **Query analysis**  | EXPLAIN plans as an annotated tree (self time or self cost, estimated vs actual rows, loops, buffers), clearly labelled estimated or measured. Warnings for misestimates, discarded rows and on-disk sorts. EXPLAIN ANALYZE only on request, always rolled back.                                                                                                         |
| **Data explorer**   | Server-side pagination, sorting, typed filters and text search; row inspector; column metadata; insert, edit and bulk delete by primary key, with PostgreSQL's own casting and constraint errors.                                                                                                                                                                        |
| **Analytics**       | Query counts, success rate, p50/p95, slowest queries and frequent errors from the app's history; table sizes, scans, dead rows, cache hit ratio and unused indexes from `pg_stat_*`. Nothing is simulated.                                                                                                                                                               |
| **Import / export** | Streamed CSV import with preview, auto column mapping, "all or nothing" or "skip invalid rows" (savepoints isolate bad lines, each reported with its error). Streamed CSV and INSERT exports, and a full schema SQL export.                                                                                                                                              |
| **Accounts**        | Registration, login, logout, password reset by email (Mailpit locally), profile, password change (signs out other sessions), preferences, account deletion.                                                                                                                                                                                                              |

---

## Quick start

Requirements: Docker (with Compose v2). Nothing else; PostgreSQL runs in containers.

```bash
docker compose up --build
```

Then open **http://localhost:3300** and choose **Explore the live demo**, or create an account.

| Service       | Address               | Notes                                 |
| ------------- | --------------------- | ------------------------------------- |
| App           | http://localhost:3300 | Bound to 127.0.0.1 only               |
| Mailpit inbox | http://localhost:8025 | Password-reset emails land here       |
| Databases     | not published         | Reachable only from the app container |

The first start migrates the application database and builds the demo template (about a second). Stop with `docker compose down`; add `-v` to delete all data.

The defaults in `docker-compose.yml` are for local use. For anything else, set real secrets in `.env` (see [Environment variables](#environment-variables)).

---

## Local development

Node 20.9+ (developed on Node 24/25) and Docker.

```bash
npm install            # also copies Monaco into public/monaco
npm run setup          # creates .env with a generated encryption key
npm run services       # PostgreSQL x2 + Mailpit, published on 127.0.0.1
npm run dev            # http://localhost:3300
```

`npm run services` uses `docker-compose.dev.yml`, which publishes the application database on `127.0.0.1:5436`, the target server on `127.0.0.1:5437` and Mailpit SMTP on `127.0.0.1:1025`. The app migrates its database on startup; `npm run db:migrate` does it by hand.

| Script                        | Purpose                                                               |
| ----------------------------- | --------------------------------------------------------------------- |
| `npm run dev`                 | Next.js dev server on port 3300                                       |
| `npm run build` / `npm start` | Production build and server                                           |
| `npm run typecheck`           | `tsc --noEmit` (strict, `noUncheckedIndexedAccess`)                   |
| `npm run lint`                | oxlint (correctness errors, suspicious warnings, React rules)         |
| `npm test`                    | Unit and component tests                                              |
| `npm run test:integration`    | Integration tests against a disposable PostgreSQL 17 (Testcontainers) |
| `npm run test:e2e`            | Playwright end-to-end tests (needs `npm run services`)                |
| `npm run stack`               | `docker compose up --build -d`                                        |

---

## Architecture

One Next.js 16 application (App Router, TypeScript) with two separate PostgreSQL servers:

```
                 ┌───────────────────────── Docker network: backend (internal) ─────────────────────────┐
 browser ──► app (Next.js, uid 1001, read-only FS)                                                      │
                 │   ├─ app-db     PostgreSQL 17: users, sessions, projects, encrypted credentials,     │
                 │   │             drafts, migrations, saved queries, history, activity                 │
                 │   └─ target-db  PostgreSQL 17: demo template + one database per sandbox,              │
                 │                 reached only through per-sandbox roles; the app holds a              │
                 │                 non-superuser provisioner (CREATEDB, CREATEROLE)                     │
                 └──────────────────────────────────────────────────────────────────────────────────────┘
```

Code layout:

| Path             | Contents                                                                                                                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app`        | Pages (App Router) and API route handlers (thin: parse, authorise, call a service)                                                                                                                                  |
| `src/server`     | Server-only modules: config, auth, sessions, crypto, rate limits, HTTP wrapper, provisioning, connection pools, the guarded query harness, introspection, migrations, data explorer, import/export, analytics, demo |
| `src/shared`     | Code used by both sides: the schema model, PostgreSQL type catalog, validation, diff engine, DDL generation, SQL splitter, identifier quoting, zod schemas                                                          |
| `src/features`   | UI by area: designer, sql, explorer, migrations, analytics, transfer, settings, projects, workspace                                                                                                                 |
| `src/components` | Shared UI: buttons, fields, dialogs, menus, toasts, data grid, SQL highlighting                                                                                                                                     |
| `db/migrations`  | Application database migrations (forward-only, checksummed)                                                                                                                                                         |
| `db/demo`        | The e-commerce demo dataset (deterministic SQL)                                                                                                                                                                     |
| `docker/`        | Target server initialisation (provisioner role)                                                                                                                                                                     |
| `tests/`, `e2e/` | Vitest unit/component/integration suites and Playwright specs                                                                                                                                                       |

Key flows are described in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Security model

The short version (full detail in [docs/SECURITY.md](docs/SECURITY.md)):

- **The database enforces read-only, not the text of the query.** Reads run as a role with only `CONNECT`, `USAGE` and `SELECT`, inside `BEGIN READ ONLY`. After every statement the harness checks the transaction is still its own and still read-only.
- **One statement per protocol message.** User SQL is split for usability, then each statement goes through the extended query protocol, which PostgreSQL refuses to run with more than one statement.
- **Bounded runs.** `statement_timeout`, plus a server-side watchdog that cancels and then terminates the backend, so `SET statement_timeout = 0` does not help. Rows are capped at the portal, not after fetching. Connections are `DISCARD ALL`ed before they return to the pool.
- **Isolation per sandbox.** Each sandbox is its own database with its own owner and read-only roles and `CONNECT` revoked from `PUBLIC`; the provisioner is not a superuser.
- **Secrets.** Database passwords are AES-256-GCM encrypted with the record id as associated data; the key lives outside the repository (env or a 0600 file in a Docker volume). No password ever reaches the browser. Sessions store only a SHA-256 of the token.
- **Web.** Ownership checks on every project route (404, not 403), same-origin checks on mutating requests, SameSite=Lax HttpOnly cookies, nonce-based CSP, rate limits on authentication, demo creation, queries and writes.
- **SSRF.** External connections are off by default; when enabled, hosts must be allowlisted, every resolved address is checked (loopback, link-local and cloud metadata are always refused; private ranges need an explicit CIDR) and the connection is pinned to the checked address.

---

## Demo mode

**Explore the live demo** creates a guest account, a project called _Storefront_ and a private copy of the e-commerce database (6 tables, about 17,700 rows: customers, categories, products, orders, order items, payments, plus a view), cloned from a template in well under a second. Six example queries are saved in the project.

Visitors can use everything, including write mode, migrations and imports, because each copy belongs to one visitor. Guests expire after `DEMO_TTL_HOURS` (24 by default); a sweep every 10 minutes drops expired guests and their databases, and sandbox databases left behind by a crash. Demo creation is limited per address and globally, and stops at `DEMO_MAX_ACTIVE`.

A walkthrough suited to a short video is in [docs/DEMO.md](docs/DEMO.md).

---

## Testing

| Suite       | Command                    | What it covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit        | `npm test`                 | SQL splitter, identifier quoting, type catalog, diff engine (renames, swaps, dependency order, destructive flags), validation, designer operations, encryption, password hashing, rate limits, CSRF checks, the SSRF guard                                                                                                                                                                                                                                                                                      |
| Component   | `npm test`                 | Grid cells, CSV quoting, typed confirmation dialog, plan view labelling and warnings                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Integration | `npm run test:integration` | Against a disposable PostgreSQL 17 started by Testcontainers and initialised like production: authentication and sessions, password reset, cross-user isolation (service and HTTP layer), sandbox role boundaries, query execution and escape attempts, timeouts and cancellation, EXPLAIN, introspection, migrations (apply, failure rollback, destructive confirmation, staleness, optimistic concurrency), schema export round trip, data explorer writes, CSV import and export, demo isolation and cleanup |
| End to end  | `npm run test:e2e`         | Demo journey, register → design → migrate → insert → query, authentication guards, CSV import through the UI                                                                                                                                                                                                                                                                                                                                                                                                    |

Results at the time of writing: 115 unit and component tests, 53 integration tests and 6 end-to-end tests passing; type check, lint and production build clean.

---

## Environment variables

All variables are validated at startup (`src/server/config.ts`); invalid configuration stops the server with a precise message. `.env.example` lists every one with comments.

| Variable                                                                    | Default                              | Purpose                                                                    |
| --------------------------------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------- |
| `APP_URL`                                                                   | `http://localhost:3300`              | Public URL: email links and the CSRF origin                                |
| `DATABASE_URL`                                                              | (required)                           | Application database                                                       |
| `TARGET_DB_HOST`, `TARGET_DB_PORT`                                          | `localhost`, `5437`                  | Target server for sandboxes                                                |
| `TARGET_DB_PROVISIONER_USER` / `_PASSWORD`                                  | `dataforge_provisioner` / (required) | Non-superuser provisioning role                                            |
| `TARGET_DB_ADMIN_DATABASE`                                                  | `dataforge_admin`                    | Provisioner's maintenance database                                         |
| `DATAFORGE_ENCRYPTION_KEY`                                                  | empty                                | 32 bytes, base64. When empty, a key is generated into `DATAFORGE_KEY_FILE` |
| `DATAFORGE_KEY_FILE`                                                        | `.data/encryption.key`               | Key file location (a volume in Docker)                                     |
| `SMTP_URL`, `MAIL_FROM`                                                     | Mailpit in Compose                   | Outgoing email                                                             |
| `EXTERNAL_CONNECTIONS`                                                      | `disabled`                           | `disabled` or `allowlist`                                                  |
| `EXTERNAL_HOST_ALLOWLIST`                                                   | empty                                | Hostnames, `*.domain`, IPs or CIDRs                                        |
| `DEMO_ENABLED`, `DEMO_TTL_HOURS`, `DEMO_MAX_ACTIVE`, `DEMO_STARTS_PER_HOUR` | `true`, `24`, `40`, `6`              | Demo controls                                                              |
| `SANDBOX_MAX_PER_USER`, `SANDBOX_MAX_TOTAL`, `SANDBOX_MAX_SIZE_MB`          | `3`, `200`, `100`                    | Sandbox limits; writes pause above the size limit                          |
| `QUERY_TIMEOUT_MS`, `QUERY_MAX_ROWS`, `IMPORT_MAX_BYTES`                    | `15000`, `1000`, `10485760`          | Query and import limits                                                    |
| `SECURE_COOKIES`                                                            | `true` when `APP_URL` is https       | Cookie `Secure` flag                                                       |
| `TRUST_PROXY`                                                               | `false`                              | Use the last `X-Forwarded-For` hop (behind a trusted proxy)                |
| `LOG_LEVEL`                                                                 | `info`                               | pino log level                                                             |

Docker Compose also reads `APP_DB_PASSWORD`, `TARGET_DB_SUPERUSER_PASSWORD`, `TARGET_DB_PROVISIONER_PASSWORD`, `APP_PORT` and `MAILPIT_UI_PORT`.

---

## Deployment

The image is a multi-stage build producing the Next.js standalone server (Node 24 Alpine, uid 1001). Compose runs it with a read-only root filesystem, `no-new-privileges`, all capabilities dropped, memory and PID limits, and a health check on `/api/health`.

To deploy:

1. Provide two PostgreSQL 17 servers: one for application metadata, one for sandboxes. Keeping them separate means user workloads can never touch DataForge's own data. Initialise the target server once with `docker/target-db/01-provisioner.sh`, run as its superuser.
2. Set `DATABASE_URL`, the `TARGET_DB_*` variables, `DATAFORGE_ENCRYPTION_KEY` (back it up: losing it makes saved credentials unreadable), `APP_URL` (https), `SMTP_URL`.
3. Put the app behind a TLS-terminating reverse proxy that overwrites `X-Forwarded-For`, and set `TRUST_PROXY=true`.
4. Run a single app instance (see limitations), or move rate limits and the running-query registry to shared storage first.

Before exposing it publicly, review [docs/SECURITY.md](docs/SECURITY.md#before-a-public-deployment).

---

## Known limitations

- **Single instance.** Rate limits and the registry of running queries (used for cancellation) are in memory. Multiple instances need a shared store for both.
- **Schema designer scope.** Tables, columns, types, nullability, defaults, identity, comments, primary keys, unique constraints and foreign keys are editable. Check constraints, indexes, views, enums, partitions, triggers and functions are introspected and preserved but edited in the SQL editor. Moving tables between schemas and reordering physical columns are not supported. Composite foreign keys are shown and preserved; creating them is single-column in the UI.
- **Drafts are not merged.** If the database changes outside the designer while a draft has unapplied edits, the draft is marked stale and can be reset to the database; there is no three-way merge.
- **Sandboxes use the `public` schema.** The owner role cannot create schemas (by design).
- **Read-only on external databases** relies on READ ONLY transactions plus the role you provide. For a hard guarantee, supply a role that only has SELECT.
- **Size limits are checked, not enforced by the server.** PostgreSQL has no per-database quota; writes are refused once a sandbox exceeds its limit, so a single statement can overshoot it.
- **EXPLAIN ANALYZE** rolls back data changes but not side effects outside the transaction (for example, sequence values).
- **Email** in production needs an SMTP provider; without one, reset links are only logged in development.

---

## Future improvements

- Shared rate limiting and query registry (PostgreSQL `LISTEN/NOTIFY` or Redis) for multiple instances.
- Index and check-constraint editing in the designer; composite foreign keys by drag.
- Three-way merge of drafts against out-of-band schema changes.
- Plan comparison (before and after an index) and `pg_stat_statements` integration where available.
- Collaborative editing of drafts (presence and conflict resolution, as in CollabCode).
- Migration down-scripts for reversible operations, and export as numbered migration files.
- Per-sandbox resource governance with a pooler (pgbouncer) and server-side quotas.

---

## License

MIT
