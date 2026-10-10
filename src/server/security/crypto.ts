import 'server-only'
import {
    createCipheriv,
    createDecipheriv,
    createHash,
    randomBytes,
    timingSafeEqual,
} from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { config } from '@/server/config'
import { log } from '@/server/logger'

// Secrets at rest: database passwords are encrypted with AES-256-GCM under a
// server-held key. The ciphertext is bound to the record it belongs to (the
// connection id is the GCM associated data), so a ciphertext copied into
// another row does not decrypt.

const VERSION = 'v1'
let key: Buffer | undefined

function loadKey(): Buffer {
    if (key) return key
    const fromEnv = config().DATAFORGE_ENCRYPTION_KEY
    if (fromEnv) {
        const decoded = Buffer.from(fromEnv, 'base64')
        if (decoded.length !== 32) {
            throw new Error('DATAFORGE_ENCRYPTION_KEY must be 32 bytes, base64 encoded.')
        }
        key = decoded
        return key
    }
    // No key configured: use (or create) a key file outside the repository.
    // Docker keeps it in a dedicated volume; local development in .data/.
    const file = path.resolve(config().DATAFORGE_KEY_FILE)
    if (existsSync(file)) {
        const decoded = Buffer.from(readFileSync(file, 'utf8').trim(), 'base64')
        if (decoded.length !== 32) throw new Error(`Encryption key file ${file} is invalid.`)
        key = decoded
        return key
    }
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
    const generated = randomBytes(32)
    writeFileSync(file, generated.toString('base64'), { mode: 0o600, flag: 'wx' })
    chmodSync(file, 0o600)
    log.warn({ file }, 'generated a new encryption key; back it up to keep saved credentials')
    key = generated
    return key
}

export function encryptSecret(plaintext: string, boundTo: string): string {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', loadKey(), iv)
    cipher.setAAD(Buffer.from(boundTo, 'utf8'))
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    return [
        VERSION,
        iv.toString('base64'),
        tag.toString('base64'),
        ciphertext.toString('base64'),
    ].join(':')
}

export function decryptSecret(payload: string, boundTo: string): string {
    const [version, iv, tag, ciphertext] = payload.split(':')
    if (version !== VERSION || !iv || !tag || !ciphertext) {
        throw new Error('Unrecognised secret format')
    }
    const decipher = createDecipheriv('aes-256-gcm', loadKey(), Buffer.from(iv, 'base64'))
    decipher.setAAD(Buffer.from(boundTo, 'utf8'))
    decipher.setAuthTag(Buffer.from(tag, 'base64'))
    return Buffer.concat([
        decipher.update(Buffer.from(ciphertext, 'base64')),
        decipher.final(),
    ]).toString('utf8')
}

/** URL-safe random token with 256 bits of entropy. */
export function randomToken(bytes = 32): string {
    return randomBytes(bytes).toString('base64url')
}

export function sha256(value: string): Buffer {
    return createHash('sha256').update(value, 'utf8').digest()
}

export function safeEqual(a: Buffer, b: Buffer): boolean {
    return a.length === b.length && timingSafeEqual(a, b)
}

/** Test hook. */
export function setEncryptionKeyForTests(value: Buffer | undefined) {
    key = value
}
