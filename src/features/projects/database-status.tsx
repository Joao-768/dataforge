import { Badge } from '@/components/ui/badge'
import type { ProjectSummary } from '@/server/projects/service'

export function DatabaseStatus({ database }: { database: ProjectSummary['database'] }) {
    if (!database) return <Badge>No database</Badge>
    if (database.status === 'ready') {
        return (
            <Badge tone="ok" dot>
                {database.kind === 'managed' ? 'Sandbox ready' : 'Connected'}
            </Badge>
        )
    }
    if (database.status === 'provisioning') {
        return (
            <Badge tone="warn" dot pulse>
                Provisioning
            </Badge>
        )
    }
    return (
        <Badge tone="danger" dot>
            Unreachable
        </Badge>
    )
}
