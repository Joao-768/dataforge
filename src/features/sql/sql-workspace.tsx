'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Editor, type Monaco, type OnMount } from '@monaco-editor/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels'
import { format as formatSql } from 'sql-formatter'
import { ChevronDown, Lock, Play, Plus, Save, Unlock, Wand2, X } from 'lucide-react'
import { Button, IconButton } from '@/components/ui/button'
import { ConfirmDialog, Dialog } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Menu } from '@/components/ui/menu'
import { useToast } from '@/components/ui/toast'
import { api, ApiError, projectApi } from '@/lib/api'
import { useResolvedTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'
import type { ExplainResult, RunResult } from '@/server/query/executor'
import type { UserSettings } from '@/server/auth/service'
import { splitStatements, statementAt } from '@/shared/sql/split'
import { useProject, useProjectId } from '@/features/workspace/context'
import { useLiveSchema } from '@/features/workspace/queries'
import { defineTheme, LANGUAGE, registerCompletion } from '@/features/sql/monaco'
import { ResultsPanel, type Outcome } from '@/features/sql/results'
import { SqlSidebar, type SavedQuery } from '@/features/sql/sidebar'
import { useQueryTabs } from '@/features/sql/tabs'

type CodeEditor = Parameters<OnMount>[0]

interface Submission {
    sql: string
    /** Offset of `sql` within the editor content, for error markers. */
    offset: number
}

export function SqlWorkspace() {
    const projectId = useProjectId()
    const { data: project } = useProject()
    const toast = useToast()
    const queryClient = useQueryClient()
    const theme = useResolvedTheme()
    const schema = useLiveSchema(projectId)
    const settings = useQuery({
        queryKey: ['settings'],
        queryFn: () => api<UserSettings>('/api/me/settings'),
    })
    const tabsState = useQueryTabs((state) => state.projects[projectId])
    const ensure = useQueryTabs((state) => state.ensure)
    const open = useQueryTabs((state) => state.open)
    const close = useQueryTabs((state) => state.close)
    const activate = useQueryTabs((state) => state.activate)
    const update = useQueryTabs((state) => state.update)
    const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({})
    const [mode, setMode] = useState<'read' | 'write'>('read')
    const [writeIntro, setWriteIntro] = useState(false)
    const [pendingWrite, setPendingWrite] = useState<Submission | null>(null)
    const [pendingAnalyze, setPendingAnalyze] = useState<Submission | null>(null)
    const [saving, setSaving] = useState(false)
    const editorRef = useRef<CodeEditor | null>(null)
    const monacoRef = useRef<Monaco | null>(null)
    const runIdRef = useRef<string | null>(null)
    const schemaRef = useRef(schema.data)
    useEffect(() => {
        schemaRef.current = schema.data
    }, [schema.data])
    const vertical = useDefaultLayout({
        id: 'dataforge:sql:vertical',
        panelIds: ['editor', 'results'],
    })
    const horizontal = useDefaultLayout({
        id: 'dataforge:sql:horizontal',
        panelIds: ['sidebar', 'main'],
    })

    useEffect(() => ensure(projectId), [ensure, projectId])
    const tabs = tabsState?.tabs ?? []
    const activeTab = tabs.find((tab) => tab.id === tabsState?.activeId) ?? tabs[0]
    const outcome: Outcome = (activeTab && outcomes[activeTab.id]) ?? { kind: 'idle' }
    const running = outcome.kind === 'running'
    const canWrite = project?.connection?.canWrite ?? false

    useEffect(() => {
        if (monacoRef.current)
            monacoRef.current.editor.setTheme(defineTheme(monacoRef.current, theme))
    }, [theme])

    const setOutcome = useCallback(
        (tabId: string, next: Outcome) => setOutcomes((current) => ({ ...current, [tabId]: next })),
        [],
    )

    const clearMarkers = () => {
        const model = editorRef.current?.getModel()
        if (model && monacoRef.current)
            monacoRef.current.editor.setModelMarkers(model, 'dataforge', [])
    }

    const markError = (offset: number, message: string) => {
        const editor = editorRef.current
        const monaco = monacoRef.current
        const model = editor?.getModel()
        if (!editor || !monaco || !model) return
        const start = model.getPositionAt(offset)
        const word = model.getWordAtPosition(start)
        monaco.editor.setModelMarkers(model, 'dataforge', [
            {
                startLineNumber: start.lineNumber,
                startColumn: word?.startColumn ?? start.column,
                endLineNumber: start.lineNumber,
                endColumn: word?.endColumn ?? start.column + 1,
                message,
                severity: monaco.MarkerSeverity.Error,
            },
        ])
        editor.revealPositionInCenterIfOutsideViewport(start)
    }

    /** The selection, or the statement under the cursor, or everything. */
    const currentSubmission = (whole: boolean): Submission | null => {
        const editor = editorRef.current
        const model = editor?.getModel()
        if (!editor || !model) return null
        const text = model.getValue()
        if (whole) return { sql: text, offset: 0 }
        const selection = editor.getSelection()
        if (selection && !selection.isEmpty()) {
            return {
                sql: model.getValueInRange(selection),
                offset: model.getOffsetAt(selection.getStartPosition()),
            }
        }
        const statement = statementAt(text, model.getOffsetAt(editor.getPosition()!))
        return statement ? { sql: statement.text, offset: statement.start } : null
    }

    const execute = async (submission: Submission, runMode: 'read' | 'write') => {
        if (!activeTab) return
        const tabId = activeTab.id
        if (!splitStatements(submission.sql).length) {
            toast('There is no SQL to run here.', 'error')
            return
        }
        clearMarkers()
        const runId = crypto.randomUUID()
        runIdRef.current = runId
        setOutcome(tabId, { kind: 'running', startedAt: Date.now(), mode: runMode })
        try {
            const result = await api<RunResult>(projectApi(projectId, '/query'), {
                body: {
                    sql: submission.sql,
                    mode: runMode,
                    runId,
                    maxRows: settings.data?.defaultRowLimit,
                },
            })
            setOutcome(tabId, { kind: 'run', result })
            if (result.error?.position !== null && result.error?.position !== undefined) {
                markError(submission.offset + result.error.position, result.error.message)
            }
            if (runMode === 'write' && result.status === 'success') {
                void queryClient.invalidateQueries({ queryKey: ['schema', projectId] })
                void queryClient.invalidateQueries({ queryKey: ['draft', projectId] })
            }
        } catch (error) {
            const info = error instanceof ApiError ? error : null
            setOutcome(tabId, {
                kind: 'failure',
                message: info?.message ?? 'The query could not be sent.',
            })
        } finally {
            runIdRef.current = null
            void queryClient.invalidateQueries({ queryKey: ['history', projectId] })
        }
    }

    const run = (whole = false) => {
        if (running) return
        const submission = currentSubmission(whole)
        if (!submission) return
        if (mode === 'write' && (settings.data?.confirmWriteQueries ?? true)) {
            setPendingWrite(submission)
            return
        }
        void execute(submission, mode)
    }

    const explain = async (analyze: boolean, confirmed = false) => {
        if (running || !activeTab) return
        const submission = currentSubmission(false)
        if (!submission) return
        if (splitStatements(submission.sql).length !== 1) {
            toast('Place the cursor in (or select) a single statement to explain.', 'error')
            return
        }
        if (analyze && !confirmed) {
            setPendingAnalyze(submission)
            return
        }
        const tabId = activeTab.id
        clearMarkers()
        setOutcome(tabId, { kind: 'running', startedAt: Date.now(), mode: 'explain' })
        try {
            const result = await api<ExplainResult>(projectApi(projectId, '/query/explain'), {
                body: { sql: submission.sql, analyze, mode: analyze ? mode : 'read' },
            })
            setOutcome(tabId, { kind: 'explain', result })
        } catch (error) {
            const info =
                error instanceof ApiError
                    ? (error.details as {
                          code?: string
                          detail?: string
                          hint?: string
                          position?: number
                      } | null)
                    : null
            setOutcome(tabId, {
                kind: 'failure',
                message: error instanceof ApiError ? error.message : 'EXPLAIN failed',
                code: info?.code,
                detail: info?.detail,
                hint: info?.hint,
            })
        } finally {
            void queryClient.invalidateQueries({ queryKey: ['history', projectId] })
        }
    }

    const cancel = async () => {
        const runId = runIdRef.current
        if (!runId) return
        try {
            await api(projectApi(projectId, '/query/cancel'), { body: { runId } })
        } catch {
            toast('Could not cancel the query', 'error')
        }
    }

    const format = () => {
        const editor = editorRef.current
        const model = editor?.getModel()
        if (!editor || !model) return
        try {
            const formatted = formatSql(model.getValue(), {
                language: 'postgresql',
                keywordCase: 'upper',
                tabWidth: 4,
            })
            editor.executeEdits('format', [{ range: model.getFullModelRange(), text: formatted }])
        } catch {
            toast('This SQL could not be formatted.', 'error')
        }
    }

    const saveQuery = async (name: string) => {
        if (!activeTab) return
        const sql = editorRef.current?.getValue() ?? activeTab.sql
        try {
            const saved = activeTab.savedQueryId
                ? await api<SavedQuery>(projectApi(projectId, `/saved/${activeTab.savedQueryId}`), {
                      method: 'PUT',
                      body: { name, sql },
                  })
                : await api<SavedQuery>(projectApi(projectId, '/saved'), { body: { name, sql } })
            update(projectId, activeTab.id, { savedQueryId: saved.id, title: saved.name })
            void queryClient.invalidateQueries({ queryKey: ['saved', projectId] })
            toast('Query saved', 'success')
            setSaving(false)
        } catch (error) {
            toast(error instanceof ApiError ? error.message : 'Could not save the query', 'error')
        }
    }

    // Keep the latest handlers reachable from Monaco's commands.
    const handlers = useRef({ run, explain, format, cancel, save: () => setSaving(true) })
    useEffect(() => {
        handlers.current = { run, explain, format, cancel, save: () => setSaving(true) }
    })

    const onMount: OnMount = (editor, monaco) => {
        editorRef.current = editor
        monacoRef.current = monaco
        monaco.editor.setTheme(defineTheme(monaco, theme))
        registerCompletion(monaco, () => schemaRef.current)
        const { KeyMod, KeyCode } = monaco
        editor.addCommand(KeyMod.CtrlCmd | KeyCode.Enter, () => handlers.current.run(false))
        editor.addCommand(KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Enter, () =>
            handlers.current.run(true),
        )
        editor.addCommand(KeyMod.CtrlCmd | KeyCode.KeyE, () => void handlers.current.explain(false))
        editor.addCommand(KeyMod.CtrlCmd | KeyCode.KeyS, () => handlers.current.save())
        editor.addCommand(KeyMod.Shift | KeyMod.Alt | KeyCode.KeyF, () => handlers.current.format())
        editor.focus()
    }

    // Shortcuts outside the editor: Esc cancels, Alt+N opens a tab.
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && runIdRef.current) {
                event.preventDefault()
                void handlers.current.cancel()
            } else if (event.altKey && event.code === 'KeyN') {
                event.preventDefault()
                open(projectId)
            }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [open, projectId])

    const insert = (text: string) => {
        const editor = editorRef.current
        if (!editor) return
        const selection = editor.getSelection()
        if (selection)
            editor.executeEdits('insert', [{ range: selection, text, forceMoveMarkers: true }])
        editor.focus()
    }

    if (!activeTab) return null

    return (
        <div className="flex h-[calc(100svh-var(--masthead-height)-var(--tabs-height)-44px)] min-h-[520px] flex-col">
            <Group
                orientation="horizontal"
                className="h-full"
                defaultLayout={horizontal.defaultLayout}
                onLayoutChanged={horizontal.onLayoutChanged}
            >
                <Panel
                    id="sidebar"
                    defaultSize="20"
                    minSize="14"
                    maxSize="40"
                    collapsible
                    collapsedSize="0"
                    className="hidden md:block"
                >
                    <SqlSidebar
                        projectId={projectId}
                        schema={schema.data}
                        onInsert={insert}
                        onOpen={(tab) => open(projectId, tab)}
                    />
                </Panel>
                <Separator className="hidden md:block" />
                <Panel id="main" minSize="40">
                    <div className="flex h-full flex-col">
                        <div className="flex h-9 shrink-0 items-stretch border-b border-rule bg-panel">
                            <div
                                role="tablist"
                                aria-label="Query tabs"
                                className="scrollbar-thin flex min-w-0 flex-1 overflow-x-auto"
                            >
                                {tabs.map((tab) => (
                                    <div
                                        key={tab.id}
                                        className={cn(
                                            'group relative flex shrink-0 items-center border-r border-rule',
                                            tab.id === activeTab.id
                                                ? 'bg-paper text-ink'
                                                : 'text-ink-3 hover:text-ink',
                                        )}
                                    >
                                        {tab.id === activeTab.id ? (
                                            <span className="absolute inset-x-0 top-0 h-[2px] bg-accent" />
                                        ) : null}
                                        <button
                                            type="button"
                                            role="tab"
                                            aria-selected={tab.id === activeTab.id}
                                            onClick={() => activate(projectId, tab.id)}
                                            className="max-w-[12rem] truncate py-1 pr-1 pl-3 text-[12.5px]"
                                        >
                                            {tab.title}
                                        </button>
                                        <button
                                            type="button"
                                            aria-label={`Close ${tab.title}`}
                                            onClick={() => close(projectId, tab.id)}
                                            className="mr-1.5 rounded p-0.5 opacity-50 hover:bg-raised hover:opacity-100"
                                        >
                                            <X size={11} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                            <IconButton
                                label="New tab (Alt+N)"
                                size="sm"
                                className="my-1 mr-1"
                                onClick={() => open(projectId)}
                            >
                                <Plus size={14} />
                            </IconButton>
                        </div>
                        <div className="flex h-11 shrink-0 flex-wrap items-center gap-1.5 border-b border-rule px-2">
                            <Button
                                size="sm"
                                variant="primary"
                                onClick={() => run(false)}
                                busy={running}
                                title="Run selection or current statement (⌘/Ctrl+Enter)"
                            >
                                {running ? null : (
                                    <Play size={12} className="fill-current" aria-hidden="true" />
                                )}{' '}
                                Run
                            </Button>
                            <Button
                                size="sm"
                                onClick={() => run(true)}
                                disabled={running}
                                title="Run the whole script (⌘/Ctrl+Shift+Enter)"
                                className="hidden sm:inline-flex"
                            >
                                Run all
                            </Button>
                            <Menu
                                label="Explain"
                                align="start"
                                trigger={({ toggle, ref, id, open: isOpen }) => (
                                    <Button
                                        ref={ref}
                                        id={id}
                                        size="sm"
                                        onClick={toggle}
                                        disabled={running}
                                        aria-haspopup="menu"
                                        aria-expanded={isOpen}
                                    >
                                        Explain <ChevronDown size={12} aria-hidden="true" />
                                    </Button>
                                )}
                                items={[
                                    {
                                        label: 'EXPLAIN (estimated plan)',
                                        hint: '⌘E',
                                        onSelect: () => void explain(false),
                                    },
                                    {
                                        label: 'EXPLAIN ANALYZE (executes the statement)',
                                        onSelect: () => void explain(true),
                                    },
                                ]}
                            />
                            <IconButton label="Format SQL (Shift+Alt+F)" onClick={format}>
                                <Wand2 size={14} />
                            </IconButton>
                            <IconButton
                                label="Save query (⌘/Ctrl+S)"
                                onClick={() => setSaving(true)}
                            >
                                <Save size={14} />
                            </IconButton>
                            <div className="ml-auto flex items-center gap-2">
                                <div
                                    role="radiogroup"
                                    aria-label="Execution mode"
                                    className="flex h-8 items-center rounded-md border border-rule-strong p-0.5"
                                >
                                    <button
                                        type="button"
                                        role="radio"
                                        aria-checked={mode === 'read'}
                                        onClick={() => setMode('read')}
                                        className={cn(
                                            'flex h-full items-center gap-1 rounded px-2 text-[12px]',
                                            mode === 'read'
                                                ? 'bg-raised text-ink'
                                                : 'text-ink-3 hover:text-ink',
                                        )}
                                    >
                                        <Lock size={11} /> Read
                                    </button>
                                    <button
                                        type="button"
                                        role="radio"
                                        aria-checked={mode === 'write'}
                                        disabled={!canWrite}
                                        title={
                                            canWrite
                                                ? 'Run with the owner role; changes are committed'
                                                : 'This connection has no write credentials'
                                        }
                                        onClick={() => setWriteIntro(true)}
                                        className={cn(
                                            'flex h-full items-center gap-1 rounded px-2 text-[12px] disabled:opacity-40',
                                            mode === 'write'
                                                ? 'bg-accent text-on-ink'
                                                : 'text-ink-3 hover:text-ink',
                                        )}
                                    >
                                        <Unlock size={11} /> Write
                                    </button>
                                </div>
                            </div>
                        </div>
                        {mode === 'write' ? (
                            <p className="border-b border-accent/40 bg-accent-soft px-3 py-1 text-[11.5px] text-accent-text">
                                Write mode: statements run as the owner role in one transaction,
                                committed only if every statement succeeds.
                            </p>
                        ) : null}
                        <Group
                            orientation="vertical"
                            className="min-h-0 flex-1"
                            defaultLayout={vertical.defaultLayout}
                            onLayoutChanged={vertical.onLayoutChanged}
                        >
                            <Panel id="editor" defaultSize="48" minSize="15">
                                <Editor
                                    key={activeTab.id}
                                    language={LANGUAGE}
                                    defaultValue={activeTab.sql}
                                    onChange={(value) =>
                                        update(projectId, activeTab.id, { sql: value ?? '' })
                                    }
                                    onMount={onMount}
                                    theme={`dataforge-${theme}`}
                                    loading={
                                        <div className="p-4 text-[12px] text-ink-3">
                                            Loading editor…
                                        </div>
                                    }
                                    options={{
                                        fontFamily:
                                            'var(--font-geist-mono), ui-monospace, monospace',
                                        fontSize: settings.data?.editorFontSize ?? 13,
                                        lineHeight: 1.6,
                                        minimap: { enabled: false },
                                        scrollBeyondLastLine: false,
                                        renderLineHighlight: 'line',
                                        padding: { top: 10 },
                                        tabSize: 4,
                                        automaticLayout: true,
                                        wordWrap: 'on',
                                        fixedOverflowWidgets: true,
                                        quickSuggestions: {
                                            other: true,
                                            strings: false,
                                            comments: false,
                                        },
                                        ariaLabel: 'SQL editor',
                                    }}
                                />
                            </Panel>
                            <Separator />
                            <Panel id="results" minSize="15" className="bg-paper">
                                <ResultsPanel outcome={outcome} onCancel={() => void cancel()} />
                            </Panel>
                        </Group>
                    </div>
                </Panel>
            </Group>

            <ConfirmDialog
                open={writeIntro}
                onClose={() => setWriteIntro(false)}
                onConfirm={() => {
                    setMode('write')
                    setWriteIntro(false)
                }}
                title="Switch to write mode?"
                confirmLabel="Enable write mode"
                tone="primary"
            >
                <p>
                    Queries will run as the database owner role. Each run is a single transaction:
                    it is committed only when every statement succeeds, and rolled back otherwise.
                </p>
                <p>Changes such as DELETE, UPDATE or DROP cannot be undone from DataForge.</p>
            </ConfirmDialog>
            <ConfirmDialog
                open={pendingWrite !== null}
                onClose={() => setPendingWrite(null)}
                onConfirm={() => {
                    const submission = pendingWrite
                    setPendingWrite(null)
                    if (submission) void execute(submission, 'write')
                }}
                title="Run with write access?"
                confirmLabel="Run and commit"
                tone="primary"
            >
                <p>
                    {pendingWrite ? splitStatements(pendingWrite.sql).length : 0} statement(s) will
                    run as the owner role and be committed if all succeed. You can turn this
                    confirmation off in account settings.
                </p>
            </ConfirmDialog>
            <ConfirmDialog
                open={pendingAnalyze !== null}
                onClose={() => setPendingAnalyze(null)}
                onConfirm={() => {
                    setPendingAnalyze(null)
                    void explain(true, true)
                }}
                title="Run EXPLAIN ANALYZE?"
                confirmLabel="Execute and measure"
                tone="primary"
            >
                <p>
                    EXPLAIN ANALYZE executes the statement to measure it, so it takes as long as the
                    query itself.
                </p>
                <p>
                    {mode === 'read'
                        ? 'It runs in a read-only transaction: statements that change data will be refused.'
                        : 'It runs with write access inside a transaction that is always rolled back, so data changes are discarded. Sequence values it consumes are not.'}
                </p>
            </ConfirmDialog>
            <SaveDialog
                open={saving}
                initialName={activeTab.title}
                onClose={() => setSaving(false)}
                onSave={saveQuery}
            />
        </div>
    )
}

function SaveDialog({
    open,
    initialName,
    onClose,
    onSave,
}: {
    open: boolean
    initialName: string
    onClose: () => void
    onSave: (name: string) => Promise<void>
}) {
    const [name, setName] = useState(initialName)
    const [busy, setBusy] = useState(false)
    const [wasOpen, setWasOpen] = useState(open)
    // Each time the dialog opens it starts from the tab's current title.
    if (open !== wasOpen) {
        setWasOpen(open)
        if (open) setName(initialName)
    }
    return (
        <Dialog open={open} onClose={onClose} title="Save query" size="sm">
            <form
                onSubmit={async (event) => {
                    event.preventDefault()
                    if (!name.trim()) return
                    setBusy(true)
                    await onSave(name.trim())
                    setBusy(false)
                }}
                className="space-y-4"
            >
                <Field
                    label="Name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    autoFocus
                    maxLength={120}
                />
                <div className="flex justify-end gap-2">
                    <Button variant="ghost" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button type="submit" variant="primary" busy={busy} disabled={!name.trim()}>
                        Save
                    </Button>
                </div>
            </form>
        </Dialog>
    )
}
