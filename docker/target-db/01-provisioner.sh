#!/bin/sh
# Runs once, as the server superuser, when the target-db volume is first
# initialised. It creates the only role DataForge uses on this server: a
# provisioner that can create databases and roles but is not a superuser.
# Every sandbox database then gets its own owner and read-only roles, created
# by the provisioner, so no user SQL ever runs with administrative rights.
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
    -v provisioner_password="$DATAFORGE_PROVISIONER_PASSWORD" <<'SQL'
CREATE ROLE dataforge_provisioner
    LOGIN CREATEDB CREATEROLE
    CONNECTION LIMIT 20
    PASSWORD :'provisioner_password';

-- Roles the provisioner creates are granted to it with SET and INHERIT, so it
-- can act as a sandbox owner while seeding or reassigning objects.
ALTER ROLE dataforge_provisioner SET createrole_self_grant = 'set, inherit';

-- The provisioner's own maintenance database.
CREATE DATABASE dataforge_admin OWNER dataforge_provisioner;
REVOKE ALL ON DATABASE dataforge_admin FROM PUBLIC;

-- Sandbox roles may only ever connect to their own database.
REVOKE ALL ON DATABASE postgres FROM PUBLIC;
REVOKE ALL ON DATABASE template1 FROM PUBLIC;
SQL
