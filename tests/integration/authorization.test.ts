import { describe, expect, it } from 'vitest'
import { POST as runQueryRoute } from '@/app/api/projects/[projectId]/query/route'
import {
    GET as projectRoute,
    DELETE as deleteProjectRoute,
} from '@/app/api/projects/[projectId]/route'
import { browse } from '@/server/data/explorer'
import { getDraft } from '@/server/migrations/service'
import { getProjectSummary } from '@/server/projects/service'
import { executeScript } from '@/server/query/executor'
import { projectTarget } from '@/server/targets/connections'
import { useSession } from '../support/cookies'
import { actAs, createProjectWithSandbox, createUser } from '../support/factory'

const request = (path: string, init: RequestInit = {}) =>
    new Request(`http://localhost:3300${path}`, {
        ...init,
        headers: {
            'content-type': 'application/json',
            origin: 'http://localhost:3300',
            host: 'localhost:3300',
            ...init.headers,
        },
    })

describe('project isolation between users', () => {
    it('hides other users’ projects behind not-found, everywhere', async () => {
        const alice = await createUser('Alice')
        const projectId = await createProjectWithSandbox(alice)
        const mallory = await createUser('Mallory')

        await expect(getProjectSummary(mallory.user.id, projectId)).rejects.toThrow(
            'Project not found',
        )
        await expect(projectTarget(mallory.user.id, projectId, 'read')).rejects.toThrow(
            'Project not found',
        )
        await expect(getDraft(mallory.user.id, projectId)).rejects.toThrow('Project not found')
        await expect(
            executeScript(mallory.user.id, projectId, { sql: 'select 1', mode: 'read' }),
        ).rejects.toThrow('Project not found')
        await expect(
            browse(mallory.user.id, projectId, {
                schema: 'public',
                table: 'users',
                page: 1,
                pageSize: 10,
                direction: 'asc',
                filters: [],
            }),
        ).rejects.toThrow('Project not found')
    })

    it('enforces ownership and authentication at the HTTP layer', async () => {
        const alice = await createUser('Alice')
        const projectId = await createProjectWithSandbox(alice)
        const mallory = await createUser('Mallory')
        const params = { params: Promise.resolve({ projectId }) }

        actAs(mallory)
        const stolen = await projectRoute(request(`/api/projects/${projectId}`), params)
        expect(stolen.status).toBe(404)
        const run = await runQueryRoute(
            request(`/api/projects/${projectId}/query`, {
                method: 'POST',
                body: JSON.stringify({ sql: 'select 1' }),
            }),
            params,
        )
        expect(run.status).toBe(404)
        const deletion = await deleteProjectRoute(
            request(`/api/projects/${projectId}`, {
                method: 'DELETE',
                body: JSON.stringify({ confirmName: 'anything' }),
            }),
            params,
        )
        expect(deletion.status).toBe(404)

        useSession(undefined)
        expect((await projectRoute(request(`/api/projects/${projectId}`), params)).status).toBe(401)

        actAs(alice)
        const own = await projectRoute(request(`/api/projects/${projectId}`), params)
        expect(own.status).toBe(200)
        const body = await own.json()
        expect(JSON.stringify(body)).not.toMatch(/password/i)
    })

    it('rejects cross-site writes even with a valid session', async () => {
        const alice = await createUser('Alice')
        const projectId = await createProjectWithSandbox(alice)
        const response = await runQueryRoute(
            request(`/api/projects/${projectId}/query`, {
                method: 'POST',
                body: JSON.stringify({ sql: 'select 1' }),
                headers: { origin: 'https://evil.example' },
            }),
            { params: Promise.resolve({ projectId }) },
        )
        expect(response.status).toBe(403)
    })

    it('requires the exact project name to delete', async () => {
        const alice = await createUser('Alice')
        const projectId = await createProjectWithSandbox(alice)
        const response = await deleteProjectRoute(
            request(`/api/projects/${projectId}`, {
                method: 'DELETE',
                body: JSON.stringify({ confirmName: 'wrong' }),
            }),
            { params: Promise.resolve({ projectId }) },
        )
        expect(response.status).toBe(422)
    })
})
