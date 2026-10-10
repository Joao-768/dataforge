import { Suspense } from 'react'
import { DataExplorer } from '@/features/explorer/explorer'
import { RequiresDatabase } from '@/features/workspace/requires-database'

export const metadata = { title: 'Data explorer' }

export default function DataPage() {
    return (
        <RequiresDatabase>
            <Suspense>
                <DataExplorer />
            </Suspense>
        </RequiresDatabase>
    )
}
