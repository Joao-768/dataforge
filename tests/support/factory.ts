import { randomUUID } from 'node:crypto'
import { register } from '@/server/auth/service'
import { currentUser, type SessionUser } from '@/server/auth/session'
import { createProject } from '@/server/projects/service'
import { provisionManaged } from '@/server/targets/connections'
import { resetRateLimitsForTests } from '@/server/security/rate-limit'
import { clearCookies, sessionToken, useSession } from './cookies'

export interface TestUser {
    user: SessionUser
    token: string
    password: string
}

/** Registers a user and leaves their session active in the cookie jar. */
export async function createUser(name = 'Test User'): Promise<TestUser> {
    resetRateLimitsForTests()
    clearCookies()
    const password = 'correct-horse-battery'
    await register({ name, email: `user-${randomUUID()}@example.com`, password })
    const token = sessionToken()!
    const user = (await currentUser())!
    return { user, token, password }
}

export function actAs(user: TestUser) {
    useSession(user.token)
}

export async function createProjectWithSandbox(
    owner: TestUser,
    template: 'empty' | 'ecommerce' = 'ecommerce',
): Promise<string> {
    actAs(owner)
    const project = await createProject(owner.user.id, {
        name: `Project ${randomUUID().slice(0, 8)}`,
        description: '',
    })
    await provisionManaged(owner.user.id, project.id, template, { isGuest: false })
    return project.id
}
