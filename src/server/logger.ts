import 'server-only'
import pino from 'pino'

// Structured JSON logs. Anything that could carry credentials, SQL text or
// row data is redacted by path, so a careless `log.info({ connection })`
// cannot leak a password or a user's records.
export const log = pino({
    level: process.env.LOG_LEVEL ?? 'info',
    base: { service: 'dataforge' },
    redact: {
        paths: [
            'password',
            '*.password',
            '*.*.password',
            'passwordHash',
            '*.passwordHash',
            'token',
            '*.token',
            'cookie',
            '*.cookie',
            'headers.cookie',
            'connectionString',
            '*.connectionString',
            'sql',
            '*.sql',
            'values',
            '*.values',
            'rows',
            '*.rows',
        ],
        censor: '[redacted]',
    },
    timestamp: pino.stdTimeFunctions.isoTime,
})
