import 'server-only'
import type { Target } from '@/server/targets/connections'
import { introspect } from '@/server/schema/introspect'
import type { LiveSchema } from '@/shared/schema/model'

// Short-lived cache of introspection results, so paging through a table does
// not re-read the catalog on every request. Anything DataForge does that can
// change structure (write-mode SQL, migrations, imports) invalidates it.

const TTL_MS = 5_000
const cache = new Map<string, { schema: LiveSchema; at: number }>()

export async function liveSchema(target: Target, { fresh = false } = {}): Promise<LiveSchema> {
    const key = target.connection.id
    const hit = cache.get(key)
    if (!fresh && hit && Date.now() - hit.at < TTL_MS) return hit.schema
    const client = await target.pool.connect()
    try {
        const schema = await introspect(client)
        cache.set(key, { schema, at: Date.now() })
        return schema
    } finally {
        client.release()
    }
}

export function invalidateSchema(connectionId: string) {
    cache.delete(connectionId)
}
