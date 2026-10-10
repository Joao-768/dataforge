import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import pg from 'pg'
import type { TestProject } from 'vitest/node'

// One disposable PostgreSQL 17 server for the whole integration run. It plays
// both roles the app expects: the application database (dataforge_test) and
// the target server, initialised exactly like docker/target-db does it: a
// non-superuser provisioner, CONNECT revoked from PUBLIC.

let container: StartedPostgreSqlContainer | undefined

const PROVISIONER_PASSWORD = 'provisioner-test'

export async function setup(project: TestProject) {
    container = await new PostgreSqlContainer('postgres:17-alpine')
        .withDatabase('postgres')
        .withUsername('postgres')
        .withPassword('postgres')
        .withCommand(['postgres', '-c', 'max_connections=200', '-c', 'fsync=off'])
        .start()

    const admin = new pg.Client({ connectionString: container.getConnectionUri() })
    await admin.connect()
    await admin.query(
        `CREATE ROLE dataforge_provisioner LOGIN CREATEDB CREATEROLE PASSWORD '${PROVISIONER_PASSWORD}'`,
    )
    await admin.query(`ALTER ROLE dataforge_provisioner SET createrole_self_grant = 'set, inherit'`)
    await admin.query('CREATE DATABASE dataforge_admin OWNER dataforge_provisioner')
    await admin.query('REVOKE ALL ON DATABASE dataforge_admin FROM PUBLIC')
    await admin.query('REVOKE ALL ON DATABASE postgres FROM PUBLIC')
    await admin.query('REVOKE ALL ON DATABASE template1 FROM PUBLIC')
    await admin.query('CREATE DATABASE dataforge_test')
    await admin.end()

    const host = container.getHost()
    const port = container.getPort()
    project.provide('env', {
        DATABASE_URL: `postgres://postgres:postgres@${host}:${port}/dataforge_test`,
        TARGET_DB_HOST: host,
        TARGET_DB_PORT: String(port),
        TARGET_DB_ADMIN_DATABASE: 'dataforge_admin',
        TARGET_DB_PROVISIONER_USER: 'dataforge_provisioner',
        TARGET_DB_PROVISIONER_PASSWORD: PROVISIONER_PASSWORD,
        SUPERUSER_URL: container.getConnectionUri(),
    })
}

export async function teardown() {
    await container?.stop()
}

declare module 'vitest' {
    export interface ProvidedContext {
        env: Record<string, string>
    }
}
