import { Transfer } from '@/features/transfer/transfer'
import { RequiresDatabase } from '@/features/workspace/requires-database'

export const metadata = { title: 'Import and export' }

export default function TransferPage() {
    return (
        <RequiresDatabase>
            <Transfer />
        </RequiresDatabase>
    )
}
