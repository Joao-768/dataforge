'use client'

import { useMemo, useRef, useState } from 'react'
import Papa from 'papaparse'
import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Download, FileSpreadsheet, FileUp, Upload, XCircle } from 'lucide-react'
import { DataGrid } from '@/components/data-grid'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Alert, LoadingRows } from '@/components/ui/feedback'
import { Checkbox } from '@/components/ui/field'
import { Panel, PanelHeader } from '@/components/ui/panel'
import { useToast } from '@/components/ui/toast'
import { api, ApiError, projectApi } from '@/lib/api'
import { formatBytes, formatDuration, formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { ImportReport } from '@/server/transfer/csv-import'
import { useProjectId } from '@/features/workspace/context'
import { useLiveSchema } from '@/features/workspace/queries'

const MAX_BYTES = 10 * 1024 * 1024
const PREVIEW_ROWS = 20

interface Preview {
    file: File
    headers: string[]
    rows: string[][]
    delimiter: ',' | ';' | '\t' | '|'
}

const normalize = (value: string) =>
    value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '')

export function Transfer() {
    const projectId = useProjectId()
    const schema = useLiveSchema(projectId)
    return (
        <main className="mx-auto w-full max-w-[1300px] px-4 pt-6 pb-16 sm:px-6">
            <div className="mb-6">
                <p className="eyebrow mb-1.5">Import and export</p>
                <h1 className="text-[22px] font-semibold tracking-[-0.015em]">Import / Export</h1>
                <p className="mt-1 max-w-2xl text-[13.5px] text-ink-2">
                    CSV imports stream into the database in batches, inside a transaction. Exports
                    stream straight from a server-side cursor, so table size does not matter.
                </p>
            </div>
            {schema.isLoading ? (
                <LoadingRows rows={6} />
            ) : schema.data ? (
                <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
                    <ImportPanel
                        tables={schema.data.tables.map((table) => ({
                            schema: table.schema,
                            name: table.name,
                            columns: table.columns
                                .filter(
                                    (column) => !column.generated && column.identity !== 'always',
                                )
                                .map((column) => ({
                                    name: column.name,
                                    type: column.type,
                                    nullable: column.nullable,
                                    hasDefault: column.default !== null || column.identity !== null,
                                })),
                        }))}
                    />
                    <ExportPanel
                        tables={schema.data.tables.map((table) => ({
                            schema: table.schema,
                            name: table.name,
                            rows: table.rowEstimate,
                        }))}
                    />
                </div>
            ) : (
                <Alert>Could not read the schema.</Alert>
            )}
        </main>
    )
}

interface ImportTable {
    schema: string
    name: string
    columns: { name: string; type: string; nullable: boolean; hasDefault: boolean }[]
}

function ImportPanel({ tables }: { tables: ImportTable[] }) {
    const projectId = useProjectId()
    const toast = useToast()
    const queryClient = useQueryClient()
    const input = useRef<HTMLInputElement>(null)
    const [preview, setPreview] = useState<Preview | null>(null)
    const [hasHeader, setHasHeader] = useState(true)
    const [tableKey, setTableKey] = useState('')
    const [mapping, setMapping] = useState<Record<string, number | null>>({})
    const [emptyIsNull, setEmptyIsNull] = useState(true)
    const [mode, setMode] = useState<'atomic' | 'skip_invalid'>('atomic')
    const [busy, setBusy] = useState(false)
    const [report, setReport] = useState<ImportReport | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [dragging, setDragging] = useState(false)

    const table = tables.find((candidate) => `${candidate.schema}.${candidate.name}` === tableKey)
    const headers = useMemo(() => {
        if (!preview) return []
        return hasHeader
            ? preview.headers
            : preview.headers.map((_, index) => `column ${index + 1}`)
    }, [preview, hasHeader])

    function autoMap(target: ImportTable | undefined, names: string[]) {
        if (!target) return {}
        const result: Record<string, number | null> = {}
        for (const column of target.columns) {
            const index = names.findIndex((header) => normalize(header) === normalize(column.name))
            result[column.name] = index === -1 ? null : index
        }
        return result
    }

    function load(file: File) {
        setError(null)
        setReport(null)
        if (file.size > MAX_BYTES) {
            setError(
                `The file is ${formatBytes(file.size)}; the limit is ${formatBytes(MAX_BYTES)}.`,
            )
            return
        }
        // Parse only the first rows locally, for the preview and mapping.
        Papa.parse<string[]>(file, {
            preview: PREVIEW_ROWS + 1,
            skipEmptyLines: true,
            complete(result) {
                const data = result.data.filter((row) => row.length > 0)
                if (data.length === 0) {
                    setError('The file is empty.')
                    return
                }
                const delimiter = (
                    ['\t', ';', '|'].includes(result.meta.delimiter) ? result.meta.delimiter : ','
                ) as Preview['delimiter']
                const first = data[0]!
                const next = { file, headers: first, rows: data.slice(1), delimiter }
                setPreview(next)
                const guess = tables.find(
                    (candidate) =>
                        normalize(file.name.replace(/\.[^.]+$/, '')) === normalize(candidate.name),
                )
                const chosen =
                    guess ??
                    tables.find((candidate) => `${candidate.schema}.${candidate.name}` === tableKey)
                if (guess) setTableKey(`${guess.schema}.${guess.name}`)
                setMapping(
                    autoMap(
                        chosen,
                        hasHeader ? first : first.map((_, index) => `column ${index + 1}`),
                    ),
                )
            },
            error() {
                setError('That file could not be read as CSV.')
            },
        })
    }

    async function runImport() {
        if (!preview || !table) return
        const entries = Object.entries(mapping).filter(
            (entry): entry is [string, number] => entry[1] !== null,
        )
        if (entries.length === 0) {
            setError('Map at least one column.')
            return
        }
        setBusy(true)
        setError(null)
        setReport(null)
        const options = {
            schema: table.schema,
            table: table.name,
            hasHeader,
            delimiter: preview.delimiter,
            mapping: entries.map(([column, source]) => ({ column, source })),
            nullValues: emptyIsNull ? [''] : [],
            mode,
        }
        try {
            const result = await api<ImportReport>(
                projectApi(
                    projectId,
                    `/import?options=${encodeURIComponent(JSON.stringify(options))}`,
                ),
                {
                    method: 'POST',
                    raw: preview.file,
                    headers: { 'Content-Type': 'text/csv' },
                },
            )
            setReport(result)
            if (result.committed) {
                toast(
                    `Imported ${formatNumber(result.inserted)} rows into ${table.name}`,
                    'success',
                )
                void queryClient.invalidateQueries({ queryKey: ['data', projectId] })
                void queryClient.invalidateQueries({ queryKey: ['schema', projectId] })
            } else {
                toast('Nothing was imported', 'error')
            }
        } catch (caught) {
            setError(caught instanceof ApiError ? caught.message : 'The import failed.')
        } finally {
            setBusy(false)
        }
    }

    const missingRequired =
        table?.columns.filter(
            (column) =>
                !column.nullable && !column.hasDefault && (mapping[column.name] ?? null) === null,
        ) ?? []

    return (
        <Panel className="min-w-0">
            <PanelHeader
                title="Import CSV"
                eyebrow="Into an existing table"
                description={`Up to ${formatBytes(MAX_BYTES)}. Values are parsed by PostgreSQL, so its rules decide what is valid.`}
            />
            <div className="space-y-5 p-4">
                <div
                    onDragOver={(event) => {
                        event.preventDefault()
                        setDragging(true)
                    }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={(event) => {
                        event.preventDefault()
                        setDragging(false)
                        const file = event.dataTransfer.files[0]
                        if (file) load(file)
                    }}
                    className={cn(
                        'flex flex-col items-center justify-center rounded-lg border border-dashed px-4 py-8 text-center transition-colors',
                        dragging ? 'border-accent bg-accent-soft/40' : 'border-rule-strong',
                    )}
                >
                    <FileUp size={20} className="text-ink-3" aria-hidden="true" />
                    {preview ? (
                        <p className="mt-2 text-[13.5px]">
                            <span className="font-medium">{preview.file.name}</span>{' '}
                            <span className="text-ink-3">
                                · {formatBytes(preview.file.size)} · delimiter “
                                {preview.delimiter === '\t' ? 'tab' : preview.delimiter}”
                            </span>
                        </p>
                    ) : (
                        <p className="mt-2 text-[13.5px] text-ink-2">Drop a CSV file here</p>
                    )}
                    <Button size="sm" className="mt-3" onClick={() => input.current?.click()}>
                        {preview ? 'Choose another file' : 'Choose file'}
                    </Button>
                    <input
                        ref={input}
                        type="file"
                        accept=".csv,text/csv,.tsv,text/tab-separated-values"
                        className="sr-only"
                        aria-label="CSV file"
                        onChange={(event) => {
                            const file = event.target.files?.[0]
                            if (file) load(file)
                            event.target.value = ''
                        }}
                    />
                </div>

                {error ? <Alert>{error}</Alert> : null}

                {preview ? (
                    <>
                        <div className="grid gap-4 md:grid-cols-2">
                            <label className="block">
                                <span className="mb-1.5 block text-[13px] font-medium text-ink-2">
                                    Target table
                                </span>
                                <select
                                    className="field"
                                    value={tableKey}
                                    onChange={(event) => {
                                        setTableKey(event.target.value)
                                        setMapping(
                                            autoMap(
                                                tables.find(
                                                    (candidate) =>
                                                        `${candidate.schema}.${candidate.name}` ===
                                                        event.target.value,
                                                ),
                                                headers,
                                            ),
                                        )
                                    }}
                                >
                                    <option value="">Choose a table…</option>
                                    {tables.map((candidate) => (
                                        <option
                                            key={`${candidate.schema}.${candidate.name}`}
                                            value={`${candidate.schema}.${candidate.name}`}
                                        >
                                            {candidate.schema === 'public'
                                                ? candidate.name
                                                : `${candidate.schema}.${candidate.name}`}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <div className="space-y-2 pt-1">
                                <Checkbox
                                    label="First row is a header"
                                    checked={hasHeader}
                                    onChange={(event) => {
                                        setHasHeader(event.target.checked)
                                        setMapping(
                                            autoMap(
                                                table,
                                                event.target.checked
                                                    ? preview.headers
                                                    : preview.headers.map(
                                                          (_, index) => `column ${index + 1}`,
                                                      ),
                                            ),
                                        )
                                    }}
                                />
                                <Checkbox
                                    label="Empty values are NULL"
                                    checked={emptyIsNull}
                                    onChange={(event) => setEmptyIsNull(event.target.checked)}
                                />
                            </div>
                        </div>

                        <div>
                            <h3 className="eyebrow mb-2">
                                Preview · first{' '}
                                {Math.min(PREVIEW_ROWS, preview.rows.length + (hasHeader ? 0 : 1))}{' '}
                                rows
                            </h3>
                            <div className="h-56 overflow-hidden rounded-md border border-rule">
                                <DataGrid
                                    columns={headers.map((name) => ({ name, type: 'text' }))}
                                    rows={
                                        hasHeader
                                            ? preview.rows
                                            : [preview.headers, ...preview.rows].slice(
                                                  0,
                                                  PREVIEW_ROWS,
                                              )
                                    }
                                />
                            </div>
                        </div>

                        {table ? (
                            <div>
                                <h3 className="eyebrow mb-2">Column mapping</h3>
                                <div className="rows rounded-md border border-rule">
                                    {table.columns.map((column) => (
                                        <div
                                            key={column.name}
                                            className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-3 px-3 py-2"
                                        >
                                            <div className="min-w-0">
                                                <p className="truncate font-mono text-[12.5px]">
                                                    {column.name}
                                                </p>
                                                <p className="font-mono text-[10.5px] text-ink-3">
                                                    {column.type}
                                                    {!column.nullable && !column.hasDefault
                                                        ? ' · required'
                                                        : column.hasDefault
                                                          ? ' · has default'
                                                          : ''}
                                                </p>
                                            </div>
                                            <select
                                                className="field field-sm"
                                                aria-label={`Source for ${column.name}`}
                                                value={mapping[column.name] ?? ''}
                                                onChange={(event) =>
                                                    setMapping({
                                                        ...mapping,
                                                        [column.name]:
                                                            event.target.value === ''
                                                                ? null
                                                                : Number(event.target.value),
                                                    })
                                                }
                                            >
                                                <option value="">
                                                    {column.hasDefault
                                                        ? 'Use the default'
                                                        : column.nullable
                                                          ? 'Leave NULL'
                                                          : 'Not mapped'}
                                                </option>
                                                {headers.map((header, index) => (
                                                    <option key={index} value={index}>
                                                        {header}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    ))}
                                </div>
                                {missingRequired.length ? (
                                    <Alert tone="warning" className="mt-2">
                                        {missingRequired.map((column) => column.name).join(', ')}{' '}
                                        {missingRequired.length === 1 ? 'is' : 'are'} required and
                                        not mapped; rows will fail.
                                    </Alert>
                                ) : null}
                            </div>
                        ) : null}

                        <fieldset>
                            <legend className="eyebrow mb-2">When a row is invalid</legend>
                            <div className="grid gap-2 md:grid-cols-2">
                                {(
                                    [
                                        [
                                            'atomic',
                                            'Import nothing',
                                            'One transaction: the first bad row cancels the import and is reported.',
                                        ],
                                        [
                                            'skip_invalid',
                                            'Skip invalid rows',
                                            'Bad rows are isolated with savepoints, reported, and the rest is imported.',
                                        ],
                                    ] as const
                                ).map(([value, title, text]) => (
                                    <label
                                        key={value}
                                        className={cn(
                                            'flex cursor-pointer gap-2.5 rounded-md border px-3 py-2.5',
                                            mode === value
                                                ? 'border-accent bg-accent-soft/40'
                                                : 'border-rule hover:border-rule-strong',
                                        )}
                                    >
                                        <input
                                            type="radio"
                                            name="mode"
                                            checked={mode === value}
                                            onChange={() => setMode(value)}
                                            className="mt-1 accent-[var(--accent)]"
                                        />
                                        <span>
                                            <span className="block text-[13px] font-medium">
                                                {title}
                                            </span>
                                            <span className="block text-[12px] text-ink-3">
                                                {text}
                                            </span>
                                        </span>
                                    </label>
                                ))}
                            </div>
                        </fieldset>

                        <div className="flex justify-end">
                            <Button
                                variant="primary"
                                onClick={runImport}
                                busy={busy}
                                disabled={!table}
                            >
                                <Upload size={14} /> Import into {table?.name ?? '…'}
                            </Button>
                        </div>
                    </>
                ) : null}

                {report ? <ImportResult report={report} /> : null}
            </div>
        </Panel>
    )
}

function ImportResult({ report }: { report: ImportReport }) {
    return (
        <div
            className={cn(
                'rounded-md border p-4',
                report.committed ? 'border-ok/40 bg-ok-soft' : 'border-danger/40 bg-danger-soft',
            )}
            role="status"
        >
            <p className="flex items-center gap-2 text-[14px] font-medium">
                {report.committed ? (
                    <CheckCircle2 size={16} className="text-ok" />
                ) : (
                    <XCircle size={16} className="text-danger" />
                )}
                {report.committed
                    ? `Imported ${formatNumber(report.inserted)} of ${formatNumber(report.totalRows)} rows`
                    : 'Nothing was imported; the transaction was rolled back'}
            </p>
            <p className="mt-1 font-mono text-[11.5px] text-ink-3">
                {formatNumber(report.totalRows)} rows read · {formatNumber(report.failedCount)}{' '}
                failed · {formatDuration(report.durationMs)}
            </p>
            {report.failed.length ? (
                <div className="mt-3 max-h-64 overflow-auto rounded border border-rule bg-paper">
                    <table className="w-full text-[12px]">
                        <thead>
                            <tr className="border-b border-rule text-left">
                                <th className="eyebrow px-3 py-1.5 font-medium">Line</th>
                                <th className="eyebrow px-3 py-1.5 font-medium">Error</th>
                            </tr>
                        </thead>
                        <tbody className="rows">
                            {report.failed.map((failure) => (
                                <tr key={failure.row}>
                                    <td className="px-3 py-1.5 font-mono">{failure.row}</td>
                                    <td className="px-3 py-1.5">{failure.message}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {report.failedCount > report.failed.length ? (
                        <p className="border-t border-rule px-3 py-1.5 text-[11.5px] text-ink-3">
                            …and {report.failedCount - report.failed.length} more
                        </p>
                    ) : null}
                </div>
            ) : null}
        </div>
    )
}

function ExportPanel({
    tables,
}: {
    tables: { schema: string; name: string; rows: number | null }[]
}) {
    const projectId = useProjectId()
    const link = (table: { schema: string; name: string }, format: 'csv' | 'sql') =>
        projectApi(
            projectId,
            `/export/table?schema=${encodeURIComponent(table.schema)}&table=${encodeURIComponent(table.name)}&format=${format}`,
        )
    return (
        <div className="space-y-6">
            <Panel>
                <PanelHeader
                    title="Export schema"
                    eyebrow="SQL"
                    description="CREATE statements for tables, keys, checks, indexes, comments and views."
                />
                <div className="p-4">
                    <a
                        href={projectApi(projectId, '/export/schema')}
                        className="inline-flex h-9 items-center gap-2 rounded-md border border-ink bg-ink px-3.5 text-sm font-medium text-on-ink hover:bg-ink-hover"
                        download
                    >
                        <Download size={14} /> Download schema.sql
                    </a>
                </div>
            </Panel>
            <Panel>
                <PanelHeader
                    title="Export data"
                    eyebrow="Per table"
                    description="CSV, or INSERT statements rendered by PostgreSQL's quote_nullable()."
                />
                {tables.length === 0 ? (
                    <p className="px-4 py-5 text-[13px] text-ink-3">No tables to export.</p>
                ) : (
                    <ul className="rows">
                        {tables.map((table) => (
                            <li
                                key={`${table.schema}.${table.name}`}
                                className="flex items-center gap-2 px-4 py-2"
                            >
                                <FileSpreadsheet size={13} className="text-ink-3" />
                                <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">
                                    {table.name}
                                </span>
                                {table.rows !== null ? (
                                    <Badge>{formatNumber(table.rows)}</Badge>
                                ) : null}
                                <a
                                    href={link(table, 'csv')}
                                    className="rounded px-1.5 py-0.5 font-mono text-[11px] text-ink-2 hover:bg-raised hover:text-ink"
                                    download
                                >
                                    CSV
                                </a>
                                <a
                                    href={link(table, 'sql')}
                                    className="rounded px-1.5 py-0.5 font-mono text-[11px] text-ink-2 hover:bg-raised hover:text-ink"
                                    download
                                >
                                    SQL
                                </a>
                            </li>
                        ))}
                    </ul>
                )}
            </Panel>
        </div>
    )
}
