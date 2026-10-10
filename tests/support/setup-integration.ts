import { afterAll, beforeAll, inject, vi } from 'vitest'
import { cookieJar, headerList } from './cookies'

vi.mock('next/headers', () => ({
    cookies: async () => cookieJar,
    headers: async () => headerList(),
}))

const env = inject('env')
Object.assign(process.env, env, {
    NODE_ENV: 'test',
    APP_URL: 'http://localhost:3300',
    LOG_LEVEL: 'fatal',
    QUERY_TIMEOUT_MS: '2000',
    DATAFORGE_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    SMTP_URL: '',
    DEMO_MAX_ACTIVE: '5',
})

beforeAll(async () => {
    const { resetConfigForTests } = await import('@/server/config')
    resetConfigForTests()
    const { appPool } = await import('@/server/db/app-db')
    const { migrateAppDatabase } = await import('@/server/db/migrate')
    await migrateAppDatabase(appPool())
})

afterAll(async () => {
    const { closeAppPool } = await import('@/server/db/app-db')
    const { closeAdminPool } = await import('@/server/targets/provisioner')
    await closeAppPool()
    await closeAdminPool()
})
