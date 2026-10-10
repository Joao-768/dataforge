// In-memory stand-in for next/headers in integration tests. Each test picks
// whose session cookie is "in the browser" with setSessionCookie().

const jar = new Map<string, string>()
let userAgent = 'vitest'

export const cookieJar = {
    get(name: string) {
        const value = jar.get(name)
        return value === undefined ? undefined : { name, value }
    },
    has(name: string) {
        return jar.has(name)
    },
    set(name: string, value: string) {
        jar.set(name, value)
    },
    delete(name: string) {
        jar.delete(name)
    },
}

export function sessionToken(): string | undefined {
    return jar.get('df_session')
}

export function setSessionCookie(token: string | undefined) {
    if (token === undefined) jar.delete('df_session')
    else jar.set('df_session', token)
}

export function clearCookies() {
    jar.clear()
}

export function headerList() {
    return new Headers({ 'user-agent': userAgent })
}

export function setUserAgent(value: string) {
    userAgent = value
}
