import Link from 'next/link'
import { AuthShell } from '@/components/auth/auth-shell'
import { ForgotPasswordForm } from '@/components/auth/forms'

export const metadata = { title: 'Reset password' }

export default function ForgotPasswordPage() {
    return (
        <AuthShell
            title="Reset your password"
            description="We will email you a link to choose a new one."
            footer={
                <Link href="/login" className="text-ink underline-offset-2 hover:underline">
                    Back to sign in
                </Link>
            }
        >
            <ForgotPasswordForm />
        </AuthShell>
    )
}
