// Typed fetch wrapper for DataForge's API. Errors come back as ApiError with
// the server's code, message and details, so forms can show field errors and
// screens can react to specific codes (e.g. a stale draft).

export class ApiError extends Error {
    constructor(
        readonly status: number,
        readonly code: string,
        message: string,
        readonly details: unknown,
    ) {
        super(message)
        this.name = 'ApiError'
    }

    /** Field errors from a 422, keyed by field path. */
    fieldErrors(): Record<string, string> {
        if (!Array.isArray(this.details)) return {}
        const errors: Record<string, string> = {}
        for (const item of this.details as { path?: string; message?: string }[]) {
            if (item.path && item.message && !errors[item.path]) errors[item.path] = item.message
        }
        return errors
    }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export async function api<T>(
    path: string,
    options: {
        method?: Method
        body?: unknown
        signal?: AbortSignal
        raw?: BodyInit
        headers?: HeadersInit
    } = {},
): Promise<T> {
    const headers = new Headers(options.headers)
    let body: BodyInit | undefined = options.raw
    if (options.body !== undefined) {
        headers.set('Content-Type', 'application/json')
        body = JSON.stringify(options.body)
    }
    let response: Response
    try {
        response = await fetch(path, {
            method: options.method ?? (body ? 'POST' : 'GET'),
            headers,
            body,
            signal: options.signal,
            credentials: 'same-origin',
        })
    } catch (error) {
        if ((error as Error).name === 'AbortError') throw error
        throw new ApiError(0, 'network', 'Could not reach DataForge. Check your connection.', null)
    }
    if (response.status === 204) return undefined as T
    const payload = await response.json().catch(() => null)
    if (!response.ok) {
        const error = (
            payload as { error?: { code: string; message: string; details: unknown } } | null
        )?.error
        if (
            response.status === 401 &&
            typeof window !== 'undefined' &&
            !path.startsWith('/api/auth')
        ) {
            window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname)}`)
        }
        throw new ApiError(
            response.status,
            error?.code ?? 'internal',
            error?.message ?? `Request failed (${response.status})`,
            error?.details ?? null,
        )
    }
    return payload as T
}

export function projectApi(projectId: string, path = '') {
    return `/api/projects/${projectId}${path}`
}
