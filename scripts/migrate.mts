// Applies application database migrations: npm run db:migrate
process.loadEnvFile?.('.env')

const { appPool, closeAppPool } = await import('@/server/db/app-db')
const { migrateAppDatabase } = await import('@/server/db/migrate')

const { applied } = await migrateAppDatabase(appPool())
console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Already up to date.')
await closeAppPool()
