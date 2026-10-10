-- DataForge application database.
--
-- This database only holds DataForge's own metadata. Data that users manage
-- lives in separate target databases, reached through the encrypted
-- credentials in `connections`.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── users and sessions ─────────────────────────────────────────────────────

CREATE TABLE users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text NOT NULL,
    name text NOT NULL,
    password_hash text NOT NULL,
    -- Guest accounts back the public demo: one per visitor, removed when
    -- `expires_at` passes.
    is_guest boolean NOT NULL DEFAULT false,
    expires_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT users_email_length CHECK (char_length(email) BETWEEN 3 AND 254),
    CONSTRAINT users_name_length CHECK (char_length(name) BETWEEN 1 AND 80),
    CONSTRAINT users_guest_expiry CHECK (is_guest = (expires_at IS NOT NULL))
);

CREATE UNIQUE INDEX users_email_key ON users (lower(email));
CREATE INDEX users_guest_expiry_idx ON users (expires_at) WHERE is_guest;

-- Only a SHA-256 hash of the session token is stored, so a leaked table does
-- not leak usable sessions.
CREATE TABLE sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    token_hash bytea NOT NULL UNIQUE,
    user_agent text,
    created_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
);

CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expiry_idx ON sessions (expires_at);

CREATE TABLE password_reset_tokens (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    token_hash bytea NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    used_at timestamptz
);

CREATE INDEX password_reset_tokens_user_idx ON password_reset_tokens (user_id);

CREATE TABLE user_settings (
    user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    editor_font_size smallint NOT NULL DEFAULT 13,
    default_row_limit integer NOT NULL DEFAULT 500,
    confirm_write_queries boolean NOT NULL DEFAULT true,
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT user_settings_font_size CHECK (editor_font_size BETWEEN 10 AND 22),
    CONSTRAINT user_settings_row_limit CHECK (default_row_limit BETWEEN 10 AND 1000)
);

-- ── projects and connections ───────────────────────────────────────────────

CREATE TABLE projects (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name text NOT NULL,
    description text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    -- Last time DataForge changed the target schema (a migration applied).
    schema_changed_at timestamptz,
    CONSTRAINT projects_name_length CHECK (char_length(name) BETWEEN 1 AND 80),
    CONSTRAINT projects_description_length CHECK (char_length(description) <= 500)
);

CREATE UNIQUE INDEX projects_owner_name_key ON projects (owner_id, lower(name));

CREATE TYPE connection_kind AS ENUM ('managed', 'external');
CREATE TYPE connection_status AS ENUM ('provisioning', 'ready', 'error');

-- One target database per project. Passwords are AES-256-GCM ciphertexts
-- bound to the row id; plaintext never leaves the server.
CREATE TABLE connections (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL UNIQUE REFERENCES projects (id) ON DELETE CASCADE,
    kind connection_kind NOT NULL,
    status connection_status NOT NULL DEFAULT 'provisioning',
    host text NOT NULL,
    port integer NOT NULL,
    database_name text NOT NULL,
    ssl_mode text NOT NULL DEFAULT 'disable',
    read_user text NOT NULL,
    read_password_enc text NOT NULL,
    write_user text,
    write_password_enc text,
    -- Managed sandboxes only: the template they were cloned from.
    template text,
    server_version text,
    last_checked_at timestamptz,
    last_error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT connections_port_range CHECK (port BETWEEN 1 AND 65535),
    CONSTRAINT connections_ssl_mode CHECK (ssl_mode IN ('disable', 'require', 'verify-full')),
    CONSTRAINT connections_write_pair CHECK ((write_user IS NULL) = (write_password_enc IS NULL))
);

CREATE INDEX connections_managed_idx ON connections (kind) WHERE kind = 'managed';

-- ── schema design ──────────────────────────────────────────────────────────

-- The designer's working document: tables, columns, constraints and canvas
-- positions, as JSON validated by the app (src/shared/schema/model.ts).
CREATE TABLE schema_drafts (
    project_id uuid PRIMARY KEY REFERENCES projects (id) ON DELETE CASCADE,
    document jsonb NOT NULL,
    -- Fingerprint of the live schema the draft was last rebased on.
    base_fingerprint text NOT NULL,
    revision integer NOT NULL DEFAULT 1,
    updated_by uuid REFERENCES users (id) ON DELETE SET NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TYPE migration_status AS ENUM ('draft', 'applying', 'applied', 'failed');

CREATE TABLE migrations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    name text NOT NULL,
    status migration_status NOT NULL DEFAULT 'draft',
    -- Generated statements, in execution order, with per-step metadata
    -- (kind, destructive, warning).
    steps jsonb NOT NULL,
    sql text NOT NULL,
    destructive boolean NOT NULL DEFAULT false,
    -- Fingerprint of the live schema the migration was generated against.
    -- Applying refuses to run if the database has changed since.
    base_fingerprint text NOT NULL,
    -- Transaction id of the apply attempt, so an interrupted apply can be
    -- reconciled with pg_xact_status() instead of guessed.
    target_xid text,
    error_message text,
    error_step integer,
    duration_ms integer,
    created_by uuid REFERENCES users (id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    applied_at timestamptz,
    CONSTRAINT migrations_name_length CHECK (char_length(name) BETWEEN 1 AND 120),
    CONSTRAINT migrations_applied_at CHECK ((status = 'applied') = (applied_at IS NOT NULL))
);

CREATE INDEX migrations_project_idx ON migrations (project_id, created_at DESC);

-- ── queries ────────────────────────────────────────────────────────────────

CREATE TABLE saved_queries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name text NOT NULL,
    sql text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT saved_queries_name_length CHECK (char_length(name) BETWEEN 1 AND 120),
    CONSTRAINT saved_queries_sql_length CHECK (char_length(sql) <= 100000)
);

CREATE INDEX saved_queries_project_idx ON saved_queries (project_id, updated_at DESC);

CREATE TYPE query_status AS ENUM ('success', 'error', 'cancelled', 'timeout');
CREATE TYPE query_mode AS ENUM ('read', 'write', 'explain', 'explain_analyze');

-- Query metadata only: statement text, timing and counts. Result rows are
-- never stored.
CREATE TABLE query_history (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    project_id uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    sql text NOT NULL,
    mode query_mode NOT NULL,
    status query_status NOT NULL,
    statement_count integer NOT NULL DEFAULT 1,
    row_count bigint,
    duration_ms integer NOT NULL,
    error_code text,
    error_message text,
    source text NOT NULL DEFAULT 'editor',
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT query_history_source CHECK (source IN ('editor', 'explorer', 'import', 'export'))
);

CREATE INDEX query_history_project_recent_idx ON query_history (project_id, created_at DESC);
CREATE INDEX query_history_project_slowest_idx ON query_history (project_id, duration_ms DESC);

-- ── activity ───────────────────────────────────────────────────────────────

CREATE TABLE activity (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    project_id uuid REFERENCES projects (id) ON DELETE CASCADE,
    kind text NOT NULL,
    message text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX activity_user_recent_idx ON activity (user_id, created_at DESC);
CREATE INDEX activity_project_recent_idx ON activity (project_id, created_at DESC);
