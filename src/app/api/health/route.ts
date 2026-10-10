import { query } from '@/server/db/app-db'
import { publicRoute } from '@/server/http/route'

export const GET = publicRoute(async () => {
    await query('SELECT 1')
    return { status: 'ok' }
})
