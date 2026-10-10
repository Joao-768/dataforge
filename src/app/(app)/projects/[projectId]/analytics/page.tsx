import { Analytics } from '@/features/analytics/analytics'
import { RequiresDatabase } from '@/features/workspace/requires-database'

export const metadata = { title: 'Analytics' }

export default function AnalyticsPage() {
    return (
        <RequiresDatabase>
            <Analytics />
        </RequiresDatabase>
    )
}
