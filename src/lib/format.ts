const numberFormat = new Intl.NumberFormat('en-US')

export function formatNumber(value: number | null | undefined): string {
    return value === null || value === undefined ? 'n/a' : numberFormat.format(value)
}

export function formatDuration(ms: number | null | undefined): string {
    if (ms === null || ms === undefined) return 'n/a'
    if (ms < 1) return `${ms.toFixed(2)} ms`
    if (ms < 1000) return `${Math.round(ms * 10) / 10} ms`
    if (ms < 60_000) return `${(ms / 1000).toFixed(2)} s`
    return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`
}

export function formatBytes(bytes: number | null | undefined): string {
    if (bytes === null || bytes === undefined) return 'n/a'
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    let value = bytes
    let unit = 0
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024
        unit += 1
    }
    return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

export function formatRelative(iso: string | null | undefined, now = Date.now()): string {
    if (!iso) return 'never'
    const seconds = Math.round((new Date(iso).getTime() - now) / 1000)
    const abs = Math.abs(seconds)
    if (abs < 45) return 'just now'
    if (abs < 3600) return relative.format(Math.round(seconds / 60), 'minute')
    if (abs < 86_400) return relative.format(Math.round(seconds / 3600), 'hour')
    if (abs < 30 * 86_400) return relative.format(Math.round(seconds / 86_400), 'day')
    return new Date(iso).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    })
}

export function formatDateTime(iso: string | null | undefined): string {
    if (!iso) return 'n/a'
    return new Date(iso).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    })
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
    return `${formatNumber(count)} ${count === 1 ? singular : plural}`
}
