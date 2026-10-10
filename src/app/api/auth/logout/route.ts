import { logout } from '@/server/auth/service'
import { publicRoute } from '@/server/http/route'

export const POST = publicRoute(async () => {
    await logout()
    return { ok: true }
})
