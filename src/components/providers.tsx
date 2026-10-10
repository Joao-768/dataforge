'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { ToastProvider } from '@/components/ui/toast'
import { ApiError } from '@/lib/api'

export function Providers({ children }: { children: ReactNode }) {
    const [client] = useState(
        () =>
            new QueryClient({
                defaultOptions: {
                    queries: {
                        staleTime: 15_000,
                        refetchOnWindowFocus: false,
                        retry: (count, error) =>
                            count < 2 &&
                            !(
                                error instanceof ApiError &&
                                error.status >= 400 &&
                                error.status < 500
                            ),
                    },
                },
            }),
    )
    return (
        <QueryClientProvider client={client}>
            <ToastProvider>{children}</ToastProvider>
        </QueryClientProvider>
    )
}
