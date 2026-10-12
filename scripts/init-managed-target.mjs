// Prepares a managed PostgreSQL server (Neon, for example) as the target
// server, where there is no superuser to run docker/target-db/01-provisioner.sh:
//
//   TARGET_OWNER_URL=postgres://owner:...@host/db?sslmode=require \
//   TARGET_DB_PROVISIONER_PASSWORD=... npm run target:init
//
// TARGET_OWNER_URL is the provider's owner role, which must have CREATEDB and
// CREATEROLE. The script creates the provisioner role and its maintenance
// database, and is safe to run again.
import pg from 'pg'

const ownerUrl = process.env.TARGET_OWNER_URL
const password = process.env.TARGET_DB_PROVISIONER_PASSWORD
const provisioner = process.env.TARGET_DB_PROVISIONER_USER || 'dataforge_provisioner'
const adminDatabase = process.env.TARGET_DB_ADMIN_DATABASE || 'dataforge_admin'
if (!ownerUrl || !password) {
    console.error('Set TARGET_OWNER_URL and TARGET_DB_PROVISIONER_PASSWORD.')
    process.exit(1)
}

const ident = (name) => `"${name.replaceAll('"', '""')}"`
const literal = (value) => `'${value.replaceAll("'", "''")}'`

async function withClient(config, work) {
    const client = new pg.Client(config)
    await client.connect()
    try {
        return await work(client)
    } finally {
        await client.end()
    }
}

await withClient({ connectionString: ownerUrl }, async (owner) => {
    const exists = await owner.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [provisioner])
    const verb = exists.rowCount ? 'ALTER' : 'CREATE'
    await owner.query(
        `${verb} ROLE ${ident(provisioner)} LOGIN CREATEDB CREATEROLE CONNECTION LIMIT 20 PASSWORD ${literal(password)}`,
    )
    // Roles the provisioner creates are granted to it with SET and INHERIT, so
    // it can act as a sandbox owner while seeding or reassigning objects.
    await owner.query(`ALTER ROLE ${ident(provisioner)} SET createrole_self_grant = 'set, inherit'`)

    // Sandbox roles may only ever connect to their own database. On a managed
    // server the owner usually cannot revoke on databases it does not own, so
    // each revoke is attempted and reported.
    const databases = await owner.query(
        'SELECT datname FROM pg_database WHERE datallowconn AND NOT datistemplate AND datname <> $1',
        [adminDatabase],
    )
    for (const { datname } of [...databases.rows, { datname: 'template1' }]) {
        try {
            await owner.query(`REVOKE ALL ON DATABASE ${ident(datname)} FROM PUBLIC`)
            console.log(`Revoked PUBLIC access to ${datname}.`)
        } catch (error) {
            console.warn(`Could not revoke PUBLIC access to ${datname}: ${error.message}`)
        }
    }

    // The provisioner bootstraps through the owner's database, which has just
    // lost its PUBLIC connect grant.
    const { rows } = await owner.query('SELECT current_database() AS name')
    await owner.query(`GRANT CONNECT ON DATABASE ${ident(rows[0].name)} TO ${ident(provisioner)}`)
})

// The maintenance database is created by the provisioner itself, so it owns it
// without the owner role having to act as the provisioner.
const provisionerUrl = new URL(ownerUrl)
provisionerUrl.username = provisioner
provisionerUrl.password = password
await withClient({ connectionString: provisionerUrl.toString() }, async (client) => {
    const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [
        adminDatabase,
    ])
    if (!exists.rowCount) await client.query(`CREATE DATABASE ${ident(adminDatabase)}`)
    await client.query(`REVOKE ALL ON DATABASE ${ident(adminDatabase)} FROM PUBLIC`)
})

console.log(`Target server ready: ${provisioner} owns ${adminDatabase}.`)
