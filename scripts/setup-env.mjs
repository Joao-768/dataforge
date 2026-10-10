// Creates .env from .env.example with a freshly generated encryption key.
// Never overwrites an existing .env.
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

if (existsSync('.env')) {
    console.log('.env already exists; leaving it unchanged.')
    process.exit(0)
}
const key = randomBytes(32).toString('base64')
const content = readFileSync('.env.example', 'utf8').replace(
    /^DATAFORGE_ENCRYPTION_KEY=.*$/m,
    `DATAFORGE_ENCRYPTION_KEY=${key}`,
)
writeFileSync('.env', content, { mode: 0o600 })
console.log('Created .env with a new encryption key.')
