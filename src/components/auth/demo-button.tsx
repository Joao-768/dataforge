'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { Button, type Size, type Variant } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { api, ApiError } from '@/lib/api'

/** Starts a private demo: a guest account with its own copy of the sample database. */
export function DemoButton({
    variant = 'primary',
    size = 'lg',
    label = 'Explore the live demo',
    className,
}: {
    variant?: Variant
    size?: Size
    label?: string
    className?: string
}) {
    const router = useRouter()
    const toast = useToast()
    const [busy, setBusy] = useState(false)

    async function start() {
        setBusy(true)
        try {
            const { projectId } = await api<{ projectId: string }>('/api/demo', { method: 'POST' })
            router.push(`/projects/${projectId}`)
            router.refresh()
        } catch (error) {
            toast(error instanceof ApiError ? error.message : 'Could not start the demo.', 'error')
            setBusy(false)
        }
    }

    return (
        <Button variant={variant} size={size} onClick={start} busy={busy} className={className}>
            {busy ? 'Preparing your database…' : label}
            {busy ? null : <ArrowRight size={16} aria-hidden="true" />}
        </Button>
    )
}
