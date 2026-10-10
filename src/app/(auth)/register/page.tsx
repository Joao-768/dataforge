import Link from 'next/link'
import { AuthShell } from '@/components/auth/auth-shell'
import { RegisterForm } from '@/components/auth/forms'

export const metadata = { title: 'Create account' }

export default function RegisterPage() {
    return (
        <AuthShell
            title="Create your account"
            description="Each project gets its own isolated PostgreSQL database."
            footer={
                <p>
                    Already have an account?{' '}
                    <Link href="/login" className="text-ink underline-offset-2 hover:underline">
                        Sign in
                    </Link>
                </p>
            }
        >
            <RegisterForm />
        </AuthShell>
    )
}
