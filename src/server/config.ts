import 'server-only'
import { z } from 'zod'

// Every environment variable the server reads, parsed and validated once.
// Invalid configuration stops the server at startup with a precise message
// instead of failing later on first use.

const bool = z
    .enum(['true', 'false', '1', '0'])
    .transform((value) => value === 'true' || value === '1')

const schema = z.object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    APP_URL: z.url().default('http://localhost:3300'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    APP_DB_POOL_MAX: z.coerce.number().int().min(2).max(50).default(10),

    TARGET_DB_HOST: z.string().min(1).default('localhost'),
    TARGET_DB_PORT: z.coerce.number().int().min(1).max(65535).default(5437),
    TARGET_DB_ADMIN_DATABASE: z.string().min(1).default('dataforge_admin'),
    TARGET_DB_PROVISIONER_USER: z.string().min(1).default('dataforge_provisioner'),
    TARGET_DB_PROVISIONER_PASSWORD: z.string().min(1, 'TARGET_DB_PROVISIONER_PASSWORD is required'),
    // TLS to the target server: "disable" on a private network, "verify-full"
    // for a managed server reached over the internet.
    TARGET_DB_SSL: z.enum(['disable', 'require', 'verify-full']).default('disable'),

    DATAFORGE_ENCRYPTION_KEY: z.string().optional(),
    DATAFORGE_KEY_FILE: z.string().default('.data/encryption.key'),

    SMTP_URL: z.string().optional(),
    MAIL_FROM: z.string().default('DataForge <no-reply@dataforge.local>'),

    EXTERNAL_CONNECTIONS: z.enum(['disabled', 'allowlist']).default('disabled'),
    EXTERNAL_HOST_ALLOWLIST: z.string().default(''),

    DEMO_ENABLED: bool.default(true),
    DEMO_TTL_HOURS: z.coerce.number().min(1).max(168).default(24),
    DEMO_MAX_ACTIVE: z.coerce.number().int().min(1).max(500).default(40),
    DEMO_STARTS_PER_HOUR: z.coerce.number().int().min(1).max(1000).default(6),

    SANDBOX_MAX_PER_USER: z.coerce.number().int().min(1).max(20).default(3),
    SANDBOX_MAX_TOTAL: z.coerce.number().int().min(1).max(2000).default(200),
    SANDBOX_MAX_SIZE_MB: z.coerce.number().int().min(10).max(10_000).default(100),

    QUERY_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300_000).default(15_000),
    QUERY_MAX_ROWS: z.coerce.number().int().min(10).max(10_000).default(1000),
    IMPORT_MAX_BYTES: z.coerce
        .number()
        .int()
        .min(1024)
        .max(100 * 1024 * 1024)
        .default(10 * 1024 * 1024),

    SECURE_COOKIES: bool.optional(),
    TRUST_PROXY: bool.default(false),

    // Enables POST /api/cron/sweep for hosts without a long-running process
    // (Vercel), where the housekeeping timer in bootstrap.ts cannot be relied on.
    CRON_SECRET: z.string().min(32, 'CRON_SECRET must be at least 32 characters').optional(),
})

export type AppConfig = z.infer<typeof schema> & {
    secureCookies: boolean
    externalHostAllowlist: string[]
}

let cached: AppConfig | undefined

export function config(): AppConfig {
    if (cached) return cached
    // Render publishes the service URL, so APP_URL can be left unset there.
    const parsed = schema.safeParse({
        ...process.env,
        APP_URL: process.env.APP_URL || process.env.RENDER_EXTERNAL_URL,
    })
    if (!parsed.success) {
        const issues = parsed.error.issues
            .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
            .join('\n')
        throw new Error(`Invalid DataForge configuration:\n${issues}`)
    }
    const env = parsed.data
    cached = {
        ...env,
        secureCookies: env.SECURE_COOKIES ?? env.APP_URL.startsWith('https://'),
        externalHostAllowlist: env.EXTERNAL_HOST_ALLOWLIST.split(',')
            .map((entry) => entry.trim().toLowerCase())
            .filter(Boolean),
    }
    return cached
}

/** Test hook: forget the parsed configuration so the next call re-reads env. */
export function resetConfigForTests() {
    cached = undefined
}
