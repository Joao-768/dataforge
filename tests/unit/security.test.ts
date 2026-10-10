import { randomBytes } from 'node:crypto'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from '@/server/auth/password'
import { resetConfigForTests } from '@/server/config'
import { AppError } from '@/server/errors'
import { assertSameOrigin, clientIp } from '@/server/http/route'
import { decryptSecret, encryptSecret, setEncryptionKeyForTests } from '@/server/security/crypto'
import { hit, resetRateLimitsForTests } from '@/server/security/rate-limit'
import { parseAllowlist, resolveExternalHost } from '@/server/targets/network-guard'

beforeAll(() => {
    process.env.DATABASE_URL ??= 'postgres://unused/unused'
    process.env.TARGET_DB_PROVISIONER_PASSWORD ??= 'unused'
    process.env.APP_URL = 'http://localhost:3300'
    resetConfigForTests()
    setEncryptionKeyForTests(randomBytes(32))
})

describe('credential encryption', () => {
    it('round-trips and binds the ciphertext to its record', () => {
        const sealed = encryptSecret('s3cret', 'connection-a')
        expect(sealed).toMatch(/^v1:/)
        expect(sealed).not.toContain('s3cret')
        expect(decryptSecret(sealed, 'connection-a')).toBe('s3cret')
        expect(() => decryptSecret(sealed, 'connection-b')).toThrow()
    })

    it('detects tampering', () => {
        const [version, iv, tag, data] = encryptSecret('value', 'id').split(':')
        const flipped = Buffer.from(data!, 'base64')
        flipped[0] = flipped[0]! ^ 1
        expect(() =>
            decryptSecret([version, iv, tag, flipped.toString('base64')].join(':'), 'id'),
        ).toThrow()
    })

    it('uses a fresh IV every time', () => {
        expect(encryptSecret('same', 'id')).not.toBe(encryptSecret('same', 'id'))
    })
})

describe('password hashing', () => {
    it('verifies the right password only', async () => {
        const hash = await hashPassword('correct horse battery')
        expect(hash).toMatch(/^scrypt\$/)
        expect(await verifyPassword('correct horse battery', hash)).toBe(true)
        expect(await verifyPassword('wrong', hash)).toBe(false)
        expect(await verifyPassword('anything', 'garbage')).toBe(false)
    })
})

describe('rate limiting', () => {
    afterEach(() => resetRateLimitsForTests())
    it('allows the limit and refuses the next request until the window passes', () => {
        const rule = { name: 'test', limit: 2, windowMs: 1000 }
        hit(rule, 'a', 0)
        hit(rule, 'a', 1)
        expect(() => hit(rule, 'a', 2)).toThrow(AppError)
        hit(rule, 'b', 2)
        hit(rule, 'a', 1001)
    })
})

describe('same-origin check', () => {
    const request = (headers: Record<string, string>, method = 'POST') =>
        new Request('http://localhost:3300/api/projects', { method, headers })

    it('accepts same-origin requests', () => {
        expect(() =>
            assertSameOrigin(
                request({
                    origin: 'http://localhost:3300',
                    'sec-fetch-site': 'same-origin',
                    host: 'localhost:3300',
                }),
            ),
        ).not.toThrow()
    })
    it('rejects cross-site requests', () => {
        expect(() =>
            assertSameOrigin(request({ origin: 'https://evil.example', host: 'localhost:3300' })),
        ).toThrow(/Cross-site/)
        expect(() =>
            assertSameOrigin(request({ 'sec-fetch-site': 'cross-site', host: 'localhost:3300' })),
        ).toThrow(/Cross-site/)
    })
    it('rejects a browser request without an Origin header', () => {
        expect(() => assertSameOrigin(request({ 'sec-fetch-site': 'same-origin' }))).toThrow(
            /Origin/,
        )
    })
    it('does not check safe methods', () => {
        expect(() =>
            assertSameOrigin(request({ origin: 'https://evil.example' }, 'GET')),
        ).not.toThrow()
    })
    it('reads the client address from the first forwarded hop without a trusted proxy', () => {
        expect(clientIp(request({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1' }))).toBe('1.2.3.4')
    })
})

describe('external host guard (SSRF)', () => {
    const allow = (allowlist: string[]) => ({ mode: 'allowlist' as const, allowlist })

    it('refuses everything when external connections are disabled', async () => {
        await expect(resolveExternalHost('db.example.com', { mode: 'disabled' })).rejects.toThrow(
            /disabled/,
        )
    })
    it('refuses hosts that are not on the allowlist', async () => {
        await expect(
            resolveExternalHost('203.0.113.10', allow(['db.example.com'])),
        ).rejects.toThrow(/allowlist/)
    })
    it.each(['10.1.2.3', '192.168.0.10', '100.64.0.1', 'fd00::1'])(
        'blocks private address %s unless a CIDR entry covers it',
        async (address) => {
            await expect(resolveExternalHost(address, allow(['*.example.com']))).rejects.toThrow(
                /allowlist/,
            )
            await expect(
                resolveExternalHost(address, allow(['0.0.0.0/0', '::/0'])),
            ).resolves.toBeTruthy()
        },
    )
    it.each([
        '127.0.0.1',
        '169.254.169.254',
        '0.0.0.0',
        '::1',
        'fe80::1',
        '224.0.0.1',
        '::ffff:127.0.0.1',
        '::ffff:169.254.169.254',
    ])(
        'always blocks loopback, link-local and metadata address %s, even when allowlisted',
        async (address) => {
            await expect(
                resolveExternalHost(address, allow([address, '0.0.0.0/0', '::/0'])),
            ).rejects.toThrow(/private or reserved/)
        },
    )
    it('blocks names that resolve to loopback', async () => {
        await expect(resolveExternalHost('localhost', allow(['localhost']))).rejects.toThrow(
            /private or reserved/,
        )
    })
    it('allows a private range only through an explicit CIDR entry', async () => {
        const resolved = await resolveExternalHost('10.20.30.40', allow(['10.20.0.0/16']))
        expect(resolved).toEqual({ address: '10.20.30.40', servername: undefined })
    })
    it('allows a public literal address on the allowlist', async () => {
        expect((await resolveExternalHost('8.8.8.8', allow(['8.8.8.8']))).address).toBe('8.8.8.8')
    })
    it('parses wildcard entries', () => {
        expect(
            parseAllowlist(['*.rds.amazonaws.com', 'db.example.com', '10.0.0.0/8']).wildcards,
        ).toEqual(['.rds.amazonaws.com'])
    })
})
