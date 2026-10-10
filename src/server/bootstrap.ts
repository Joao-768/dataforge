import 'server-only'
import { config } from '@/server/config'
import { appPool } from '@/server/db/app-db'
import { migrateAppDatabase } from '@/server/db/migrate'
import { sweep } from '@/server/demo/service'
import { log } from '@/server/logger'
import { ensureDemoTemplate } from '@/server/targets/provisioner'

// Startup work, run once per server process from instrumentation.ts:
// migrate the application database, make sure the demo template exists, and
// start the housekeeping sweep.

const SWEEP_INTERVAL_MS = 10 * 60_000
const globalForBoot = globalThis as unknown as { __dataforgeBooted?: boolean }

export async function bootstrap() {
    if (globalForBoot.__dataforgeBooted) return
    globalForBoot.__dataforgeBooted = true
    const env = config()
    log.info({ env: env.NODE_ENV, url: env.APP_URL }, 'starting DataForge')

    const { applied } = await migrateAppDatabase(appPool())
    if (applied.length) log.info({ applied }, 'application database migrated')

    try {
        await ensureDemoTemplate()
    } catch (error) {
        // The app still serves accounts and external connections without the
        // target server; sandboxes report the problem when requested.
        log.error({ err: error }, 'could not prepare the demo template; sandboxes are unavailable')
    }

    const timer = setInterval(() => {
        sweep().catch((error) => log.error({ err: error }, 'housekeeping sweep failed'))
    }, SWEEP_INTERVAL_MS)
    timer.unref()
    sweep().catch((error) => log.error({ err: error }, 'housekeeping sweep failed'))
}
