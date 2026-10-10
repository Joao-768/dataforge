'use client'

import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Database, Layers, Lock, Plug, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react'
import { useSessionUser } from '@/components/session'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmDialog, Dialog } from '@/components/ui/dialog'
import { Alert } from '@/components/ui/feedback'
import { Field, SelectField } from '@/components/ui/field'
import { Panel, PanelHeader } from '@/components/ui/panel'
import { useToast } from '@/components/ui/toast'
import { api, ApiError, projectApi } from '@/lib/api'
import { formatRelative } from '@/lib/format'
import type { ConnectionInfo } from '@/server/targets/connections'
import { useProjectId } from '@/features/workspace/context'

interface ConnectionResponse {
    connection: ConnectionInfo | null
    externalConnections: boolean
}

export function ConnectionPanel() {
    const projectId = useProjectId()
    const user = useSessionUser()
    const toast = useToast()
    const queryClient = useQueryClient()
    const [removing, setRemoving] = useState(false)
    const [external, setExternal] = useState(false)

    const { data, isLoading } = useQuery({
        queryKey: ['connection', projectId],
        queryFn: () => api<ConnectionResponse>(projectApi(projectId, '/connection')),
    })

    const refresh = async () => {
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['connection', projectId] }),
            queryClient.invalidateQueries({ queryKey: ['project', projectId] }),
            queryClient.invalidateQueries({ queryKey: ['schema', projectId] }),
            queryClient.invalidateQueries({ queryKey: ['projects'] }),
        ])
    }

    const check = useMutation({
        mutationFn: () =>
            api<{ connection: ConnectionInfo }>(projectApi(projectId, '/connection/check'), {
                method: 'POST',
            }),
        onSuccess: async ({ connection }) => {
            await refresh()
            toast(
                connection.status === 'ready'
                    ? 'Connection is healthy'
                    : `Connection failed: ${connection.lastError}`,
                connection.status === 'ready' ? 'success' : 'error',
            )
        },
        onError: (error) =>
            toast(error instanceof ApiError ? error.message : 'Check failed', 'error'),
    })

    const provision = useMutation({
        mutationFn: (template: 'empty' | 'ecommerce') =>
            api(projectApi(projectId, '/connection/managed'), { body: { template } }),
        onSuccess: async () => {
            await refresh()
            toast('Sandbox database ready', 'success')
        },
        onError: (error) =>
            toast(
                error instanceof ApiError ? error.message : 'Could not create the database',
                'error',
            ),
    })

    const remove = useMutation({
        mutationFn: () => api(projectApi(projectId, '/connection'), { method: 'DELETE' }),
        onSuccess: async () => {
            setRemoving(false)
            await refresh()
            toast('Database removed', 'success')
        },
        onError: (error) =>
            toast(
                error instanceof ApiError ? error.message : 'Could not remove the database',
                'error',
            ),
    })

    if (isLoading) return null
    const connection = data?.connection

    if (!connection) {
        return (
            <Panel>
                <PanelHeader
                    title="Set up a database"
                    eyebrow="Database"
                    description="Choose where this project's data lives."
                />
                <div className="grid gap-3 p-4 md:grid-cols-3">
                    <SetupOption
                        icon={Layers}
                        title="Sandbox with sample data"
                        text="Private database with an e-commerce schema and realistic rows."
                        action={
                            <Button
                                variant="primary"
                                size="sm"
                                busy={provision.isPending && provision.variables === 'ecommerce'}
                                disabled={provision.isPending}
                                onClick={() => provision.mutate('ecommerce')}
                            >
                                Create
                            </Button>
                        }
                    />
                    <SetupOption
                        icon={Database}
                        title="Empty sandbox"
                        text="Private, empty PostgreSQL database to design from scratch."
                        action={
                            <Button
                                size="sm"
                                busy={provision.isPending && provision.variables === 'empty'}
                                disabled={provision.isPending}
                                onClick={() => provision.mutate('empty')}
                            >
                                Create
                            </Button>
                        }
                    />
                    <SetupOption
                        icon={Plug}
                        title="External PostgreSQL"
                        text={
                            data?.externalConnections
                                ? 'Connect a server on this deployment’s allowlist.'
                                : 'Disabled on this deployment: outbound connections to user-supplied hosts are not allowed.'
                        }
                        disabled={!data?.externalConnections || user.isGuest}
                        action={
                            <Button
                                size="sm"
                                disabled={!data?.externalConnections || user.isGuest}
                                onClick={() => setExternal(true)}
                            >
                                {data?.externalConnections ? 'Connect' : 'Unavailable'}
                            </Button>
                        }
                    />
                </div>
                <ExternalConnectionDialog
                    open={external}
                    onClose={() => setExternal(false)}
                    onConnected={refresh}
                />
            </Panel>
        )
    }

    const managed = connection.kind === 'managed'
    return (
        <Panel>
            <PanelHeader
                title={managed ? 'Sandbox database' : 'External database'}
                eyebrow="Connection"
                actions={
                    <>
                        <Button size="sm" onClick={() => check.mutate()} busy={check.isPending}>
                            <RefreshCw size={13} aria-hidden="true" /> Check
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setRemoving(true)}>
                            <Trash2 size={13} aria-hidden="true" />{' '}
                            {managed ? 'Delete' : 'Disconnect'}
                        </Button>
                    </>
                }
            />
            {connection.status === 'error' ? (
                <div className="px-4 pt-4">
                    <Alert title="The database is unreachable">{connection.lastError}</Alert>
                </div>
            ) : null}
            <dl className="grid gap-x-6 gap-y-3 px-4 py-4 text-[13px] sm:grid-cols-2">
                <Item label="Status">
                    {connection.status === 'ready' ? (
                        <Badge tone="ok" dot>
                            Ready
                        </Badge>
                    ) : connection.status === 'error' ? (
                        <Badge tone="danger" dot>
                            Error
                        </Badge>
                    ) : (
                        <Badge tone="warn" dot pulse>
                            Provisioning
                        </Badge>
                    )}
                </Item>
                <Item label="Server">
                    {connection.serverVersion
                        ? `PostgreSQL ${connection.serverVersion}`
                        : 'unknown'}
                </Item>
                <Item label="Database">
                    <span className="font-mono text-[12.5px]">{connection.database}</span>
                </Item>
                <Item label="Host">
                    {managed ? connection.host : `${connection.host}:${connection.port}`}
                </Item>
                <Item label="Read role">
                    <span className="flex items-center gap-1.5 font-mono text-[12.5px]">
                        <Lock size={12} className="text-ink-3" aria-hidden="true" />
                        {connection.readUser}
                    </span>
                </Item>
                <Item label="Write role">
                    {connection.writeUser ? (
                        <span className="font-mono text-[12.5px]">{connection.writeUser}</span>
                    ) : (
                        <span className="text-ink-3">none (read-only connection)</span>
                    )}
                </Item>
                <Item label="Last checked">{formatRelative(connection.lastCheckedAt)}</Item>
                <Item label="Created">{formatRelative(connection.createdAt)}</Item>
            </dl>
            <p className="flex items-start gap-2 border-t border-rule px-4 py-3 text-[12.5px] text-ink-3">
                <ShieldCheck size={14} className="mt-px shrink-0 text-ok" aria-hidden="true" />
                {managed
                    ? 'Reads run as a role that can only SELECT; writes and migrations use the owner role. Neither role can reach any other database on the server. Passwords are encrypted at rest and never sent to the browser.'
                    : 'Credentials are encrypted at rest and never sent to the browser. Reads run in READ ONLY transactions; use a read-only role for a hard guarantee.'}
            </p>
            <ConfirmDialog
                open={removing}
                onClose={() => setRemoving(false)}
                onConfirm={() => remove.mutate()}
                busy={remove.isPending}
                title={managed ? 'Delete sandbox database' : 'Disconnect database'}
                confirmLabel={managed ? 'Delete database' : 'Disconnect'}
                confirmText={managed ? connection.database : undefined}
            >
                {managed ? (
                    <p>
                        The sandbox{' '}
                        <span className="font-mono text-ink">{connection.database}</span> and all of
                        its data are dropped. Migration history and saved queries stay with the
                        project.
                    </p>
                ) : (
                    <p>DataForge forgets the credentials. The database itself is not changed.</p>
                )}
            </ConfirmDialog>
        </Panel>
    )
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="min-w-0">
            <dt className="eyebrow">{label}</dt>
            <dd className="mt-1 truncate">{children}</dd>
        </div>
    )
}

function SetupOption({
    icon: Icon,
    title,
    text,
    action,
    disabled = false,
}: {
    icon: typeof Database
    title: string
    text: string
    action: React.ReactNode
    disabled?: boolean
}) {
    return (
        <div
            className={`flex flex-col rounded-md border border-rule bg-paper p-3.5 ${disabled ? 'opacity-70' : ''}`}
        >
            <Icon size={16} className="text-ink-3" aria-hidden="true" />
            <p className="mt-2 text-[13.5px] font-medium">{title}</p>
            <p className="mt-0.5 flex-1 text-[12.5px] text-ink-3">{text}</p>
            <div className="mt-3">{action}</div>
        </div>
    )
}

function ExternalConnectionDialog({
    open,
    onClose,
    onConnected,
}: {
    open: boolean
    onClose: () => void
    onConnected: () => Promise<void>
}) {
    const projectId = useProjectId()
    const toast = useToast()
    const [error, setError] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)

    async function onSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const values = Object.fromEntries(new FormData(event.currentTarget))
        setBusy(true)
        setError(null)
        try {
            await api(projectApi(projectId, '/connection/external'), {
                body: {
                    ...values,
                    port: Number(values.port || 5432),
                    writeUser: values.writeUser || undefined,
                    writePassword: values.writePassword || undefined,
                },
            })
            await onConnected()
            toast('Connected', 'success')
            onClose()
        } catch (caught) {
            setError(caught instanceof ApiError ? caught.message : 'Could not connect.')
        } finally {
            setBusy(false)
        }
    }

    return (
        <Dialog open={open} onClose={onClose} title="Connect an external database" size="md">
            <form onSubmit={onSubmit} className="space-y-3.5">
                {error ? <Alert>{error}</Alert> : null}
                <div className="grid grid-cols-[1fr_6rem] gap-3">
                    <Field label="Host" name="host" required placeholder="db.example.com" />
                    <Field label="Port" name="port" inputMode="numeric" defaultValue="5432" />
                </div>
                <Field label="Database" name="database" required />
                <SelectField label="TLS" name="sslMode" defaultValue="verify-full">
                    <option value="verify-full">Require and verify certificate</option>
                    <option value="require">Require, do not verify</option>
                    <option value="disable">Disabled</option>
                </SelectField>
                <div className="grid grid-cols-2 gap-3">
                    <Field label="Read-only user" name="readUser" required autoComplete="off" />
                    <Field
                        label="Password"
                        name="readPassword"
                        type="password"
                        required
                        autoComplete="off"
                    />
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <Field label="Write user" name="writeUser" hint="Optional" autoComplete="off" />
                    <Field
                        label="Password"
                        name="writePassword"
                        type="password"
                        autoComplete="off"
                    />
                </div>
                <div className="flex justify-end gap-2 pt-1">
                    <Button variant="ghost" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button type="submit" variant="primary" busy={busy}>
                        Test and connect
                    </Button>
                </div>
            </form>
        </Dialog>
    )
}
