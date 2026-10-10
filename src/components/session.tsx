'use client'

import { createContext, useContext, type ReactNode } from 'react'

export interface SessionUser {
    id: string
    email: string
    name: string
    isGuest: boolean
    expiresAt: string | null
}

const SessionContext = createContext<SessionUser | null>(null)

export function SessionProvider({ user, children }: { user: SessionUser; children: ReactNode }) {
    return <SessionContext.Provider value={user}>{children}</SessionContext.Provider>
}

export function useSessionUser(): SessionUser {
    const user = useContext(SessionContext)
    if (!user) throw new Error('useSessionUser must be used inside the signed-in app')
    return user
}
