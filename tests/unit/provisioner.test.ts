import { describe, expect, it, vi } from 'vitest'
import { whileInUse } from '@/server/targets/provisioner'

const inUse = () => Object.assign(new Error('source database is being accessed'), { code: '55006' })

describe('whileInUse', () => {
    it('retries while the database is in use, then returns the result', async () => {
        const work = vi
            .fn()
            .mockRejectedValueOnce(inUse())
            .mockRejectedValueOnce(inUse())
            .mockResolvedValue('created')
        await expect(whileInUse(work, { delayMs: 1 })).resolves.toBe('created')
        expect(work).toHaveBeenCalledTimes(3)
    })

    it('gives up after the last attempt', async () => {
        const work = vi.fn().mockRejectedValue(inUse())
        await expect(whileInUse(work, { attempts: 3, delayMs: 1 })).rejects.toMatchObject({
            code: '55006',
        })
        expect(work).toHaveBeenCalledTimes(3)
    })

    it('does not retry other errors', async () => {
        const work = vi
            .fn()
            .mockRejectedValue(Object.assign(new Error('permission denied'), { code: '42501' }))
        await expect(whileInUse(work, { delayMs: 1 })).rejects.toMatchObject({ code: '42501' })
        expect(work).toHaveBeenCalledTimes(1)
    })
})
