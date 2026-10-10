'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'

export default function ErrorPage({
    error,
    reset,
}: {
    error: Error & { digest?: string }
    reset: () => void
}) {
    useEffect(() => {
        console.error(error)
    }, [error])
    return (
        <div className="flex min-h-[60svh] flex-col items-center justify-center px-6 text-center">
            <p className="eyebrow">Error</p>
            <h1 className="mt-2 text-[22px] font-semibold">Something went wrong</h1>
            <p className="mt-2 max-w-md text-[14px] text-ink-2">
                The page failed to load. Try again; if it keeps happening, the server log has the
                details
                {error.digest ? ` (reference ${error.digest})` : ''}.
            </p>
            <Button variant="primary" className="mt-6" onClick={reset}>
                Try again
            </Button>
        </div>
    )
}
