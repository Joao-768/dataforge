# Security model

DataForge executes SQL written by its users. The design assumes every user, and especially every demo visitor, is hostile, and puts each boundary where PostgreSQL or the server can enforce it.

## Boundaries and how they hold

### Who can reach what

| Actor | Can | Cannot |
| --- | --- | --- |
| Browser | Call the API with a session cookie | See any database password or connection string; reach a database directly |
| Signed-in user | Act on their own projects | Read or change another user's project: every project-scoped service starts with `requireProject`, which answers 404 for projects they do not own (ids cannot be probed) |
| Sandbox read role | `CONNECT` to its database, `USAGE` on `public`, `SELECT` on its tables and sequences | Write, create temp tables, read server files, create extensions, connect to any other database (CONNECT is revoked from PUBLIC everywhere) |
| Sandbox owner role | Own and change objects in its database's `public` schema | Create schemas, roles or databases; connect elsewhere |
| Provisioner (the app) | Create and drop sandbox databases and roles, signal their backends | Anything a superuser can; it is not one |

These boundaries are exercised by the integration tests in `tests/integration/sandbox.test.ts` and `authorization.test.ts`.

### Executing user SQL

- **Read-only is enforced by PostgreSQL**: the read role has no write privileges, `default_transaction_read_only` is on for it, and every read runs in `BEGIN READ ONLY` after a snapshot has been taken (so `SET TRANSACTION READ WRITE` is refused). DataForge does not decide safety from the text of the query.
- **Transaction escapes are detected, not guessed.** Statements such as COMMIT are rejected up front for a clear message, but the guarantee is the check after every statement that the transaction is still DataForge's and still read-only.
- **One statement per message.** The extended query protocol refuses multi-statement strings.
- **Resource limits.** Role and session `statement_timeout`, `lock_timeout` and `idle_in_transaction_session_timeout`; a server-side watchdog that cancels then terminates (so disabling the timeout in SQL does not help); rows fetched through a portal with a hard cap; server-wide `temp_file_limit`; connection limits per role and small pools; per-user and global sandbox counts; writes refused above a sandbox size limit.
- **No session leakage.** `DISCARD ALL` before a connection returns to the pool resets `SET`, temp tables, prepared statements and advisory locks.
- **Generated SQL.** Identifiers are taken from the catalog and quoted; values are bind parameters cast to the catalog type (`$1::numeric(10,2)`). Designer default expressions are checked for terminators and comments, and every migration step is verified to be exactly one statement. Exports render literals with PostgreSQL's own `quote_nullable()`.
- **EXPLAIN ANALYZE** runs only when the user asks (with a confirmation that it executes the statement), under the selected role, in a transaction that is always rolled back.

### Credentials and sessions

- Database passwords are encrypted with AES-256-GCM. The IV is random per encryption, and the connection id is the associated data, so a ciphertext moved to another row fails to decrypt. The key comes from `DATAFORGE_ENCRYPTION_KEY` or a generated 0600 file in a dedicated volume; it is never in the repository.
- User passwords are hashed with scrypt (N=2^15, r=8, p=1, per-hash salt and parameters). Unknown emails still pay for a hash, so login timing does not reveal accounts.
- Session tokens are 256-bit random values in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` over https). Only their SHA-256 is stored. Sessions slide for 14 days. Password resets use single-use, one-hour tokens (also stored hashed) and sign the account out everywhere; changing the password signs out other sessions.

### Web protections

- Mutating API requests must come from the app's origin (`Origin` and `Sec-Fetch-Site`), on top of SameSite cookies.
- Content Security Policy with a per-request nonce and `strict-dynamic` for scripts, `frame-ancestors 'none'`, `object-src 'none'`. `style-src` allows inline styles because Monaco and React Flow set them at runtime. Also `X-Frame-Options: DENY`, `nosniff`, a strict referrer policy and a restrictive permissions policy.
- Rate limits: login (per address and per account), registration, password reset, demo creation (per address and globally), queries, writes, provisioning, imports and connection tests.
- All input is validated with zod at the route boundary; errors are structured, and unexpected errors are logged in full but returned as a generic message.

### Outbound connections (SSRF)

External connections are disabled unless `EXTERNAL_CONNECTIONS=allowlist`. Then:

1. The host must be on `EXTERNAL_HOST_ALLOWLIST` (exact names, `*.domain`, IPs, CIDRs).
2. Every address the name resolves to is checked. Loopback, link-local (including 169.254.169.254), unspecified and multicast addresses are always refused, even if allowlisted. Private, CGNAT and documentation ranges are refused unless a CIDR entry covers them. IPv4-mapped IPv6 addresses are checked as IPv4.
3. The connection goes to the checked address (TLS still verifies the original name), so DNS cannot change the answer in between. The check repeats on every use.

### Containers and network

- The app image runs as uid 1001 with a read-only root filesystem, `no-new-privileges`, no capabilities, and memory and PID limits.
- Both PostgreSQL servers sit on an `internal` Docker network without published ports. Only the app (and Mailpit's local inbox) bind to 127.0.0.1.
- Containers are not the security boundary for user SQL; the role and database boundaries above are.

### Logging

pino redacts passwords, tokens, cookies, connection strings, SQL text, bind values and rows. Query history stores statements and timings, never result data. Import errors are returned to the user who ran the import and are not logged.

## Before a public deployment

- Set strong values for every password in `.env` and a fresh `DATAFORGE_ENCRYPTION_KEY`, and back up the key.
- Serve over https and set `APP_URL` accordingly (cookies become `Secure`).
- Put the app behind a proxy that overwrites `X-Forwarded-For`, and set `TRUST_PROXY=true`; without it, per-address limits rely on a client-supplied header (the global demo limit and per-account login limit still apply).
- Run one app instance, or move rate limits and the running-query registry to shared storage.
- Keep `EXTERNAL_CONNECTIONS=disabled` unless you control the allowlisted targets.
- Size `DEMO_MAX_ACTIVE`, `SANDBOX_MAX_TOTAL` and the target server's `max_connections`, memory and disk together.
