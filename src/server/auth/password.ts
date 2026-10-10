import 'server-only'
import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto'

// Password hashing with scrypt from Node's standard library: memory-hard, no
// native dependency. Parameters are stored with each hash so they can be
// raised later without invalidating existing passwords.
//
// Format: scrypt$N$r$p$salt$hash (salt and hash base64).

const PARAMS = { N: 2 ** 15, r: 8, p: 1 }
const KEY_LENGTH = 32

function derive(password: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        scrypt(
            password.normalize('NFKC'),
            salt,
            KEY_LENGTH,
            { ...options, maxmem: 128 * (options.N ?? 0) * (options.r ?? 0) * 2 },
            (error, derived) => (error ? reject(error) : resolve(derived)),
        )
    })
}

export async function hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16)
    const hash = await derive(password, salt, PARAMS)
    return [
        'scrypt',
        PARAMS.N,
        PARAMS.r,
        PARAMS.p,
        salt.toString('base64'),
        hash.toString('base64'),
    ].join('$')
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
    const [scheme, n, r, p, salt, hash] = stored.split('$')
    if (scheme !== 'scrypt' || !n || !r || !p || !salt || !hash) return false
    const expected = Buffer.from(hash, 'base64')
    const actual = await derive(password, Buffer.from(salt, 'base64'), {
        N: Number(n),
        r: Number(r),
        p: Number(p),
    })
    return actual.length === expected.length && timingSafeEqual(actual, expected)
}

// A real hash of a random password: verifying against it when the email is
// unknown keeps login timing the same for existing and missing accounts.
let decoy: Promise<string> | undefined
export function decoyHash(): Promise<string> {
    decoy ??= hashPassword(randomBytes(16).toString('hex'))
    return decoy
}
