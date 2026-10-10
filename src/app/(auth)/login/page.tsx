import Link from 'next/link'
import { Suspense } from 'react'
import { AuthShell } from '@/components/auth/auth-shell'
import { DemoButton } from '@/components/auth/demo-button'
import { LoginForm } from '@/components/auth/forms'

export const metadata = { title: 'Sign in' }

export default function LoginPage() {
    return (
        <AuthShell
            title="Sign in"
            description="Welcome back to your databases."
            footer={
                <div className="space-y-3">
                    <p>
                        New here?{' '}
                        <Link
                            href="/register"
                            className="text-ink underline-offset-2 hover:underline"
                        >
                            Create an account
                        </Link>
                    </p>
                    <DemoButton
                        variant="ghost"
                        size="sm"
                        label="Or explore the demo without an account"
                    />
                </div>
            }
        >
            <Suspense>
                <LoginForm />
            </Suspense>
        </AuthShell>
    )
}
