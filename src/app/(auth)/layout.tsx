import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { currentUser } from '@/server/auth/session'

// Signed-in users skip the auth pages.
export default async function AuthLayout({ children }: { children: ReactNode }) {
    if (await currentUser()) redirect('/projects')
    return children
}
