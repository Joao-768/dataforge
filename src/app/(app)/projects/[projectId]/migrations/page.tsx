import { Suspense } from 'react'
import { Migrations } from '@/features/migrations/migrations'
import { RequiresDatabase } from '@/features/workspace/requires-database'

export const metadata = { title: 'Migrations' }

export default function MigrationsPage() {
    return (
        <RequiresDatabase>
            <Suspense>
                <Migrations />
            </Suspense>
        </RequiresDatabase>
    )
}
