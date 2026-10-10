import Link from 'next/link'
import { Logo } from '@/components/logo'
import { buttonClass } from '@/components/ui/button'

export default function NotFound() {
    return (
        <div className="blueprint flex min-h-svh flex-col items-center justify-center px-6 text-center">
            <Logo />
            <p className="eyebrow mt-10">404</p>
            <h1 className="mt-2 text-[24px] font-semibold tracking-[-0.02em]">Nothing here</h1>
            <p className="mt-2 max-w-sm text-[14px] text-ink-2">
                The page does not exist, or it belongs to a project you do not have access to.
            </p>
            <Link href="/projects" className={buttonClass('primary', 'md', 'mt-6')}>
                Back to projects
            </Link>
        </div>
    )
}
