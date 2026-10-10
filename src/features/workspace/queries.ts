'use client'

import { useQuery } from '@tanstack/react-query'
import { api, projectApi } from '@/lib/api'
import type { LiveSchema } from '@/shared/schema/model'

export interface LiveSchemaResponse extends LiveSchema {
    fingerprint: string
}

/** The live structure of the project's database, read through introspection. */
export function useLiveSchema(projectId: string, enabled = true) {
    return useQuery({
        queryKey: ['schema', projectId],
        queryFn: () => api<LiveSchemaResponse>(projectApi(projectId, '/schema')),
        enabled,
    })
}
