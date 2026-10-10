import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { Masthead } from '@/components/layout/masthead'
import { SessionProvider } from '@/components/session'
import { toPublicUser } from '@/server/auth/service'
import { currentUser } from '@/server/auth/session'

// Every page under (app) requires a valid session, checked here on the
// server (the proxy's cookie check is only a fast path).
export default async function AppLayout({ children }: { children: ReactNode }) {
    const user = await currentUser()
    if (!user) redirect('/login')
    return (
        <SessionProvider user={toPublicUser(user)}>
            <div className="flex min-h-svh flex-col">
                <Masthead />
                {children}
            </div>
        </SessionProvider>
    )
}
