// Errors the API turns into structured JSON responses. Anything that is not
// an AppError is treated as an internal error: logged in full, but reported
// to the client only as a generic message.

export type ErrorCode =
    | 'bad_request'
    | 'validation_failed'
    | 'unauthorized'
    | 'forbidden'
    | 'not_found'
    | 'conflict'
    | 'rate_limited'
    | 'payload_too_large'
    | 'unsupported'
    | 'database_error'
    | 'target_unavailable'
    | 'capacity_reached'
    | 'internal'

const STATUS: Record<ErrorCode, number> = {
    bad_request: 400,
    validation_failed: 422,
    unauthorized: 401,
    forbidden: 403,
    not_found: 404,
    conflict: 409,
    rate_limited: 429,
    payload_too_large: 413,
    unsupported: 422,
    database_error: 422,
    target_unavailable: 503,
    capacity_reached: 503,
    internal: 500,
}

export class AppError extends Error {
    readonly status: number

    constructor(
        readonly code: ErrorCode,
        message: string,
        readonly details?: unknown,
    ) {
        super(message)
        this.name = 'AppError'
        this.status = STATUS[code]
    }
}

export const notFound = (what = 'Resource') => new AppError('not_found', `${what} not found`)
