'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Monitor, Moon, Sun } from 'lucide-react'
import { useSessionUser } from '@/components/session'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Alert, LoadingRows } from '@/components/ui/feedback'
import { Checkbox, Field, SelectField } from '@/components/ui/field'
import { Panel, PanelHeader } from '@/components/ui/panel'
import { useToast } from '@/components/ui/toast'
import { api, ApiError } from '@/lib/api'
import { setThemeMode, useThemeMode, type ThemeMode } from '@/lib/theme'
import { cn } from '@/lib/utils'
import type { UserSettings } from '@/server/auth/service'
import { changePasswordSchema, profileSchema } from '@/shared/validation'

function errorsOf(issues: { path: PropertyKey[]; message: string }[]) {
    return Object.fromEntries(issues.map((issue) => [issue.path.join('.'), issue.message]))
}

export function AccountSettings() {
    const user = useSessionUser()
    return (
        <main className="mx-auto w-full max-w-[880px] space-y-6 px-4 pt-8 pb-16 sm:px-6">
            <div>
                <p className="eyebrow mb-1.5">Account</p>
                <h1 className="text-[22px] font-semibold tracking-[-0.015em]">Settings</h1>
            </div>
            {user.isGuest ? (
                <Alert tone="info" title="Demo account">
                    Profile and password belong to registered accounts. Preferences below still
                    apply to this session.
                </Alert>
            ) : null}
            <Appearance />
            <Preferences />
            {user.isGuest ? null : (
                <>
                    <Profile />
                    <Password />
                </>
            )}
            <DeleteAccount />
        </main>
    )
}

function Appearance() {
    const mode = useThemeMode()
    const options: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
        { value: 'dark', label: 'Dark', icon: Moon },
        { value: 'light', label: 'Light', icon: Sun },
        { value: 'system', label: 'System', icon: Monitor },
    ]
    return (
        <Panel>
            <PanelHeader title="Appearance" description="Saved in this browser." />
            <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-2 p-4">
                {options.map((option) => (
                    <button
                        key={option.value}
                        type="button"
                        role="radio"
                        aria-checked={mode === option.value}
                        onClick={() => setThemeMode(option.value)}
                        className={cn(
                            'flex items-center justify-center gap-2 rounded-md border px-3 py-2.5 text-[13px]',
                            mode === option.value
                                ? 'border-accent bg-accent-soft/40 text-ink'
                                : 'border-rule text-ink-2 hover:border-rule-strong',
                        )}
                    >
                        <option.icon size={14} /> {option.label}
                    </button>
                ))}
            </div>
        </Panel>
    )
}

function Preferences() {
    const toast = useToast()
    const queryClient = useQueryClient()
    const { data } = useQuery({
        queryKey: ['settings'],
        queryFn: () => api<UserSettings>('/api/me/settings'),
    })
    if (!data) {
        return (
            <Panel>
                <PanelHeader title="Editor and queries" />
                <LoadingRows rows={2} />
            </Panel>
        )
    }
    return (
        <PreferencesForm
            initial={data}
            onSaved={(saved) => queryClient.setQueryData(['settings'], saved)}
            toast={toast}
        />
    )
}

function PreferencesForm({
    initial,
    onSaved,
    toast,
}: {
    initial: UserSettings
    onSaved: (saved: UserSettings) => void
    toast: ReturnType<typeof useToast>
}) {
    const [values, setValues] = useState(initial)
    const [busy, setBusy] = useState(false)
    async function save() {
        setBusy(true)
        try {
            const saved = await api<UserSettings>('/api/me/settings', {
                method: 'PUT',
                body: values,
            })
            onSaved(saved)
            toast('Preferences saved', 'success')
        } catch (error) {
            toast(error instanceof ApiError ? error.message : 'Could not save', 'error')
        } finally {
            setBusy(false)
        }
    }
    return (
        <Panel>
            <PanelHeader title="Editor and queries" description="Stored with your account." />
            <div className="grid gap-4 p-4 sm:grid-cols-2">
                <SelectField
                    label="Editor font size"
                    value={values.editorFontSize}
                    onChange={(event) =>
                        setValues({ ...values, editorFontSize: Number(event.target.value) })
                    }
                >
                    {[11, 12, 13, 14, 15, 16, 18].map((size) => (
                        <option key={size} value={size}>
                            {size}px
                        </option>
                    ))}
                </SelectField>
                <SelectField
                    label="Rows returned per query"
                    value={values.defaultRowLimit}
                    onChange={(event) =>
                        setValues({ ...values, defaultRowLimit: Number(event.target.value) })
                    }
                    hint="Results beyond this are cut off at the database, not in the browser."
                >
                    {[100, 250, 500, 1000].map((limit) => (
                        <option key={limit} value={limit}>
                            {limit}
                        </option>
                    ))}
                </SelectField>
                <Checkbox
                    className="sm:col-span-2"
                    label="Confirm before running in write mode"
                    description="Shows a confirmation each time a script runs with write access."
                    checked={values.confirmWriteQueries}
                    onChange={(event) =>
                        setValues({ ...values, confirmWriteQueries: event.target.checked })
                    }
                />
                <div className="flex justify-end sm:col-span-2">
                    <Button variant="primary" onClick={save} busy={busy}>
                        Save preferences
                    </Button>
                </div>
            </div>
        </Panel>
    )
}

function Profile() {
    const user = useSessionUser()
    const router = useRouter()
    const toast = useToast()
    const [errors, setErrors] = useState<Record<string, string>>({})
    const [busy, setBusy] = useState(false)
    async function save(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const parsed = profileSchema.safeParse(
            Object.fromEntries(new FormData(event.currentTarget)),
        )
        if (!parsed.success) return setErrors(errorsOf(parsed.error.issues))
        setErrors({})
        setBusy(true)
        try {
            await api('/api/me', { method: 'PATCH', body: parsed.data })
            toast('Profile saved', 'success')
            router.refresh()
        } catch (error) {
            setErrors({ email: error instanceof ApiError ? error.message : 'Could not save.' })
        } finally {
            setBusy(false)
        }
    }
    return (
        <Panel>
            <PanelHeader title="Profile" />
            <form onSubmit={save} noValidate className="grid gap-4 p-4 sm:grid-cols-2">
                <Field
                    label="Name"
                    name="name"
                    defaultValue={user.name}
                    autoComplete="name"
                    error={errors.name}
                />
                <Field
                    label="Email"
                    name="email"
                    type="email"
                    defaultValue={user.email}
                    autoComplete="email"
                    error={errors.email}
                />
                <div className="flex justify-end sm:col-span-2">
                    <Button type="submit" variant="primary" busy={busy}>
                        Save profile
                    </Button>
                </div>
            </form>
        </Panel>
    )
}

function Password() {
    const toast = useToast()
    const [errors, setErrors] = useState<Record<string, string>>({})
    const [busy, setBusy] = useState(false)
    async function save(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const form = event.currentTarget
        const parsed = changePasswordSchema.safeParse(Object.fromEntries(new FormData(form)))
        if (!parsed.success) return setErrors(errorsOf(parsed.error.issues))
        setErrors({})
        setBusy(true)
        try {
            await api('/api/me/password', { body: parsed.data })
            form.reset()
            toast('Password changed. Other sessions were signed out.', 'success')
        } catch (error) {
            if (error instanceof ApiError && Object.keys(error.fieldErrors()).length)
                setErrors(error.fieldErrors())
            else
                setErrors({
                    currentPassword:
                        error instanceof ApiError
                            ? error.message
                            : 'Could not change the password.',
                })
        } finally {
            setBusy(false)
        }
    }
    return (
        <Panel>
            <PanelHeader
                title="Password"
                description="Changing it signs you out of every other session."
            />
            <form onSubmit={save} noValidate className="grid gap-4 p-4 sm:grid-cols-2">
                <Field
                    label="Current password"
                    name="currentPassword"
                    type="password"
                    autoComplete="current-password"
                    error={errors.currentPassword}
                />
                <Field
                    label="New password"
                    name="newPassword"
                    type="password"
                    autoComplete="new-password"
                    error={errors.newPassword}
                    hint="At least 10 characters."
                />
                <div className="flex justify-end sm:col-span-2">
                    <Button type="submit" variant="primary" busy={busy}>
                        Change password
                    </Button>
                </div>
            </form>
        </Panel>
    )
}

function DeleteAccount() {
    const user = useSessionUser()
    const router = useRouter()
    const [open, setOpen] = useState(false)
    const [password, setPassword] = useState('')
    const [confirm, setConfirm] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)
    async function remove() {
        setBusy(true)
        setError(null)
        try {
            await api('/api/me', {
                method: 'DELETE',
                body: { password: user.isGuest ? undefined : password, confirm },
            })
            router.push('/')
            router.refresh()
        } catch (caught) {
            setError(caught instanceof ApiError ? caught.message : 'Could not delete the account.')
            setBusy(false)
        }
    }
    return (
        <Panel className="border-danger/40">
            <PanelHeader
                eyebrow="Danger zone"
                title={user.isGuest ? 'End the demo now' : 'Delete account'}
                description={
                    user.isGuest
                        ? 'Drops your demo database right away instead of waiting for it to expire.'
                        : 'Deletes every project and drops every sandbox database you own.'
                }
            />
            <div className="p-4">
                <Button variant="danger" onClick={() => setOpen(true)}>
                    {user.isGuest ? 'End demo and delete data' : 'Delete my account'}
                </Button>
            </div>
            <Dialog
                open={open}
                onClose={() => setOpen(false)}
                size="sm"
                title="Delete account"
                footer={
                    <>
                        <Button variant="ghost" onClick={() => setOpen(false)}>
                            Cancel
                        </Button>
                        <Button
                            variant="danger"
                            busy={busy}
                            disabled={
                                confirm !== 'delete my account' || (!user.isGuest && !password)
                            }
                            onClick={remove}
                        >
                            Delete everything
                        </Button>
                    </>
                }
            >
                <div className="space-y-3">
                    {error ? <Alert>{error}</Alert> : null}
                    <p className="text-[13.5px] text-ink-2">This cannot be undone.</p>
                    {user.isGuest ? null : (
                        <Field
                            label="Password"
                            type="password"
                            value={password}
                            onChange={(event) => setPassword(event.target.value)}
                            autoComplete="current-password"
                        />
                    )}
                    <Field
                        label='Type "delete my account"'
                        value={confirm}
                        onChange={(event) => setConfirm(event.target.value)}
                        autoComplete="off"
                    />
                </div>
            </Dialog>
        </Panel>
    )
}
