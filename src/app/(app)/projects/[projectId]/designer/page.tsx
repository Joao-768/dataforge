import { Designer } from '@/features/designer/designer'
import { RequiresDatabase } from '@/features/workspace/requires-database'

export const metadata = { title: 'Schema designer' }

export default function DesignerPage() {
    return (
        <RequiresDatabase>
            <Designer />
        </RequiresDatabase>
    )
}
