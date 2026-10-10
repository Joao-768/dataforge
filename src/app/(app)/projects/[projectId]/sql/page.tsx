import { SqlWorkspace } from '@/features/sql/sql-workspace'
import { RequiresDatabase } from '@/features/workspace/requires-database'

export const metadata = { title: 'SQL editor' }

export default function SqlPage() {
    return (
        <RequiresDatabase>
            <SqlWorkspace />
        </RequiresDatabase>
    )
}
