'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { z } from 'zod'
import { Alert } from '@/components/ui/feedback'
import { Button } from '@/components/ui/button'
import { Field, PasswordField } from '@/components/ui/field'
import { api, ApiError } from '@/lib/api'
import {
    forgotPasswordSchema,
    loginSchema,
    registerSchema,
    resetPasswordSchema,
} from '@/shared/validation'

type Errors = Record<string, string>

function zodErrors(error: z.ZodError): Errors {
    const errors: Errors = {}
    for (const issue of error.issues) {
        const key = issue.path.join('.')
        if (!errors[key]) errors[key] = issue.message
    }
    return errors
}

function useForm<T extends z.ZodType>(schema: T, submit: (values: z.infer<T>) => Promise<void>) {
    const [errors, setErrors] = useState<Errors>({})
    const [formError, setFormError] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)

    async function onSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const values = Object.fromEntries(new FormData(event.currentTarget))
        const parsed = schema.safeParse(values)
        if (!parsed.success) {
            setErrors(zodErrors(parsed.error))
            return
        }
        setErrors({})
        setFormError(null)
        setBusy(true)
        try {
            await submit(parsed.data)
        } catch (error) {
            if (error instanceof ApiError) {
                const fields = error.fieldErrors()
                if (Object.keys(fields).length > 0) setErrors(fields)
                else setFormError(error.message)
            } else {
                setFormError('Something went wrong. Try again.')
            }
            setBusy(false)
        }
    }

    return { errors, formError, busy, onSubmit }
}

function safeNext(next: string | null): string {
    return next && next.startsWith('/') && !next.startsWith('//') ? next : '/projects'
}

export function LoginForm() {
    const router = useRouter()
    const params = useSearchParams()
    const reset = params.get('reset') === '1'
    const { errors, formError, busy, onSubmit } = useForm(loginSchema, async (values) => {
        await api('/api/auth/login', { body: values })
        router.push(safeNext(params.get('next')))
        router.refresh()
    })
    return (
        <form onSubmit={onSubmit} noValidate className="space-y-4">
            {reset ? (
                <Alert tone="success">Password changed. Sign in with your new password.</Alert>
            ) : null}
            {formError ? <Alert>{formError}</Alert> : null}
            <Field
                label="Email"
                name="email"
                type="email"
                autoComplete="email"
                autoFocus
                error={errors.email}
            />
            <Field
                label="Password"
                name="password"
                type="password"
                autoComplete="current-password"
                error={errors.password}
                hint={
                    <Link
                        href="/forgot-password"
                        className="text-ink-2 underline-offset-2 hover:text-ink hover:underline"
                    >
                        Forgot your password?
                    </Link>
                }
            />
            <Button type="submit" variant="primary" size="md" busy={busy} className="w-full">
                Sign in
            </Button>
        </form>
    )
}

// The confirmation only lives in the browser; the API gets the plain register body.
const registerFormSchema = registerSchema
    .extend({ confirmPassword: z.string() })
    .refine((values) => values.password === values.confirmPassword, {
        path: ['confirmPassword'],
        message: 'The two passwords do not match.',
    })

export function RegisterForm() {
    const router = useRouter()
    const { errors, formError, busy, onSubmit } = useForm(registerFormSchema, async (values) => {
        const { confirmPassword: _confirm, ...body } = values
        await api('/api/auth/register', { body })
        router.push('/projects?welcome=1')
        router.refresh()
    })
    return (
        <form onSubmit={onSubmit} noValidate className="space-y-4">
            {formError ? <Alert>{formError}</Alert> : null}
            <Field label="Name" name="name" autoComplete="name" autoFocus error={errors.name} />
            <Field
                label="Email"
                name="email"
                type="email"
                autoComplete="email"
                error={errors.email}
            />
            <PasswordField
                label="Password"
                name="password"
                autoComplete="new-password"
                error={errors.password}
                hint="At least 8 characters."
            />
            <PasswordField
                label="Confirm password"
                name="confirmPassword"
                autoComplete="new-password"
                error={errors.confirmPassword}
            />
            <Button type="submit" variant="primary" size="md" busy={busy} className="w-full">
                Create account
            </Button>
        </form>
    )
}

export function ForgotPasswordForm() {
    const [sent, setSent] = useState(false)
    const { errors, formError, busy, onSubmit } = useForm(forgotPasswordSchema, async (values) => {
        await api('/api/auth/forgot-password', { body: values })
        setSent(true)
    })
    if (sent) {
        return (
            <Alert tone="success" title="Check your inbox">
                If an account exists for that address, a reset link is on its way. It expires in an
                hour. Running locally? Open Mailpit at{' '}
                <span className="font-mono">localhost:8025</span>.
            </Alert>
        )
    }
    return (
        <form onSubmit={onSubmit} noValidate className="space-y-4">
            {formError ? <Alert>{formError}</Alert> : null}
            <Field
                label="Email"
                name="email"
                type="email"
                autoComplete="email"
                autoFocus
                error={errors.email}
            />
            <Button type="submit" variant="primary" size="md" busy={busy} className="w-full">
                Send reset link
            </Button>
        </form>
    )
}

export function ResetPasswordForm() {
    const router = useRouter()
    const params = useSearchParams()
    const token = params.get('token') ?? ''
    const schema = resetPasswordSchema.omit({ token: true })
    const { errors, formError, busy, onSubmit } = useForm(schema, async (values) => {
        await api('/api/auth/reset-password', { body: { ...values, token } })
        router.push('/login?reset=1')
    })
    if (!token) {
        return (
            <Alert title="This link is incomplete">
                Open the link from the email again, or{' '}
                <Link href="/forgot-password" className="underline">
                    request a new one
                </Link>
                .
            </Alert>
        )
    }
    return (
        <form onSubmit={onSubmit} noValidate className="space-y-4">
            {formError ? <Alert>{formError}</Alert> : null}
            <Field
                label="New password"
                name="password"
                type="password"
                autoComplete="new-password"
                autoFocus
                error={errors.password}
                hint="At least 8 characters. You will be signed out everywhere."
            />
            <Button type="submit" variant="primary" size="md" busy={busy} className="w-full">
                Set new password
            </Button>
        </form>
    )
}
