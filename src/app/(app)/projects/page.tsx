import { Suspense } from 'react'
import { Dashboard } from '@/features/projects/dashboard'

export const metadata = { title: 'Projects' }

export default function ProjectsPage() {
    return (
        <Suspense>
            <Dashboard />
        </Suspense>
    )
}
