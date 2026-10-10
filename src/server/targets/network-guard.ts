import 'server-only'
import { lookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'
import { config } from '@/server/config'
import { AppError } from '@/server/errors'

// Guards outbound connections to user-supplied database hosts (SSRF).
//
//   - External connections are off unless the deployment opts in with
//     EXTERNAL_CONNECTIONS=allowlist.
//   - The host must match EXTERNAL_HOST_ALLOWLIST (exact hostnames,
//     "*.domain" wildcards, IP addresses or CIDR ranges).
//   - Every address the name resolves to is checked. Loopback, private,
//     link-local (including cloud metadata at 169.254.169.254), CGNAT,
//     multicast and reserved ranges are refused unless an allowlisted CIDR
//     explicitly covers them.
//   - The connection is then made to the checked IP address, not the name,
//     so DNS cannot change the answer between the check and the connect.

const BLOCKED = new BlockList()
for (const [network, prefix] of [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4],
] as const) {
    BLOCKED.addSubnet(network, prefix, 'ipv4')
}
for (const [network, prefix] of [
    ['::', 128],
    ['::1', 128],
    ['::ffff:0:0', 96],
    ['64:ff9b::', 96],
    ['100::', 64],
    ['2001:db8::', 32],
    ['fc00::', 7],
    ['fe80::', 10],
    ['ff00::', 8],
] as const) {
    BLOCKED.addSubnet(network, prefix, 'ipv6')
}

interface Allowlist {
    hosts: string[]
    wildcards: string[]
    ranges: BlockList
}

export function parseAllowlist(entries: string[]): Allowlist {
    const ranges = new BlockList()
    const hosts: string[] = []
    const wildcards: string[] = []
    for (const entry of entries) {
        const [address, prefix] = entry.split('/')
        const family = isIP(address ?? '')
        if (family && address) {
            const bits = prefix === undefined ? (family === 4 ? 32 : 128) : Number(prefix)
            ranges.addSubnet(address, bits, family === 4 ? 'ipv4' : 'ipv6')
        } else if (entry.startsWith('*.')) {
            wildcards.push(entry.slice(1))
        } else {
            hosts.push(entry)
        }
    }
    return { hosts, wildcards, ranges }
}

function familyOf(address: string): 'ipv4' | 'ipv6' {
    return isIP(address) === 6 ? 'ipv6' : 'ipv4'
}

export interface ResolvedTarget {
    /** Address to connect to. */
    address: string
    /** Original hostname, used for TLS verification. */
    servername: string | undefined
}

export async function resolveExternalHost(
    host: string,
    options: { mode?: 'disabled' | 'allowlist'; allowlist?: string[] } = {},
): Promise<ResolvedTarget> {
    const mode = options.mode ?? config().EXTERNAL_CONNECTIONS
    if (mode !== 'allowlist') {
        throw new AppError(
            'unsupported',
            'External database connections are disabled on this deployment. Use a managed sandbox database instead.',
        )
    }
    const allow = parseAllowlist(options.allowlist ?? config().externalHostAllowlist)
    const name = host.trim().toLowerCase().replace(/\.$/, '')
    const literal = isIP(name)

    const nameAllowed =
        allow.hosts.includes(name) || allow.wildcards.some((suffix) => name.endsWith(suffix))
    const literalAllowed = literal ? allow.ranges.check(name, familyOf(name)) : false
    if (!nameAllowed && !literalAllowed) {
        throw new AppError('forbidden', `Host ${host} is not on this deployment's allowlist.`)
    }

    let addresses: string[]
    if (literal) {
        addresses = [name]
    } else {
        try {
            addresses = (await lookup(name, { all: true, verbatim: true })).map(
                (entry) => entry.address,
            )
        } catch {
            throw new AppError('bad_request', `Could not resolve ${host}.`)
        }
    }
    if (addresses.length === 0) throw new AppError('bad_request', `Could not resolve ${host}.`)

    for (const address of addresses) {
        const family = familyOf(address)
        if (BLOCKED.check(address, family) && !allow.ranges.check(address, family)) {
            throw new AppError(
                'forbidden',
                `${host} resolves to a private or reserved address, which is not allowed.`,
            )
        }
    }
    return { address: addresses[0]!, servername: literal ? undefined : name }
}
