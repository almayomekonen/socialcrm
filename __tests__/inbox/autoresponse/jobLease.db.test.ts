import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Auto-response job leases against a real PostgreSQL: the reclaim respects
 * maxAttempts, a live owner keeps its lease, two workers never hold one job,
 * a worker that lost its job neither sends nor resets it, and a dead worker's
 * job is recovered by the next one.
 */
import { db } from '@/config/db'
import {
  claimAutoResponseJobs,
  failAutoResponseJob,
  ownsAutoResponseJob,
  reclaimStaleAutoResponseJobs,
  renewAutoResponseJobLease,
} from '@/db/autoResponseJobs'
import { LeaseLostError, fencedSend, keepJobLease } from '@/lib/inbox/autoresponse/jobLease'
import { agency, cleanup, conversation } from '../../ownerWhatsappReminders/reminderFixtures'

const LEASE = 60_000
let A: number
const ago = (ms: number) => new Date(Date.now() - ms)

async function job(over: Record<string, unknown> = {}): Promise<number> {
  const conv = await conversation(A, { lead: false })
  const [r] = await db('auto_response_jobs')
    .insert({ agencyId: A, conversationId: conv.id, channel: 'whatsapp', reason: 'qualify_turn', triggerSequence: 1, ...over })
    .returning('id')
  return Number(r.id)
}
const row = (id: number) =>
  db('auto_response_jobs').where({ id }).first('status', 'attempts', 'lockedBy', 'lockedAt', 'lastError')

beforeAll(async () => {
  A = await agency('__job_lease__')
})
beforeEach(async () => {
  await db('auto_response_jobs').where({ agencyId: A }).del()
})
afterAll(async () => {
  await db('auto_response_jobs').where({ agencyId: A }).del()
  await cleanup()
})

describe('reclaim respects maxAttempts', () => {
  it('an expired job with attempts left goes back to pending', async () => {
    const id = await job({ status: 'processing', attempts: 1, maxAttempts: 3, lockedBy: 'w1', lockedAt: ago(2 * LEASE) })
    expect(await reclaimStaleAutoResponseJobs(LEASE)).toBe(1)
    expect(await row(id)).toMatchObject({ status: 'pending', lockedBy: null, lastError: 'lease-expired-reclaimed' })
  })

  it('an expired job that used its last attempt is dead-lettered, not retried forever', async () => {
    const id = await job({ status: 'processing', attempts: 3, maxAttempts: 3, lockedBy: 'w1', lockedAt: ago(2 * LEASE) })
    await reclaimStaleAutoResponseJobs(LEASE)
    expect(await row(id)).toMatchObject({ status: 'dead', lastError: 'lease-expired-max-attempts' })
    expect(await claimAutoResponseJobs('w2', 5)).toEqual([])
  })

  it('repeated stalls end in dead after maxAttempts claims', async () => {
    const id = await job({ maxAttempts: 3 })
    for (let i = 0; i < 5; i++) {
      await claimAutoResponseJobs(`w${i}`, 5)
      await db('auto_response_jobs')
        .where({ id })
        .update({ lockedAt: ago(2 * LEASE) }) // the worker dies
      await reclaimStaleAutoResponseJobs(LEASE)
    }
    expect(await row(id)).toMatchObject({ status: 'dead', attempts: 3 })
  })

  it('a live, unexpired job is never reclaimed', async () => {
    const id = await job({ status: 'processing', attempts: 1, lockedBy: 'w1', lockedAt: new Date() })
    expect(await reclaimStaleAutoResponseJobs(LEASE)).toBe(0)
    expect((await row(id)).status).toBe('processing')
  })
})

describe('lease renewal and ownership', () => {
  it('the owner renews its lease, so a slow turn survives the reclaim', async () => {
    const id = await job({ status: 'processing', attempts: 1, lockedBy: 'w1', lockedAt: ago(LEASE - 1_000) })
    expect(await renewAutoResponseJobLease(id, 'w1')).toBe(true)
    expect(await reclaimStaleAutoResponseJobs(LEASE)).toBe(0)
    expect((await row(id)).lockedBy).toBe('w1')
  })

  it('a non-owner cannot renew, and cannot claim ownership', async () => {
    const id = await job({ status: 'processing', attempts: 1, lockedBy: 'w1', lockedAt: new Date() })
    expect(await renewAutoResponseJobLease(id, 'w2')).toBe(false)
    expect(await ownsAutoResponseJob(id, 'w2')).toBe(false)
    expect(await ownsAutoResponseJob(id, 'w1')).toBe(true)
  })

  it('concurrent workers never claim the same job', async () => {
    const ids = await Promise.all([job(), job(), job(), job()])
    const [a, b] = await Promise.all([claimAutoResponseJobs('wa', 10), claimAutoResponseJobs('wb', 10)])
    const claimed = [...a, ...b].map((j) => j.id)
    expect(new Set(claimed).size).toBe(claimed.length)
    expect(claimed.sort()).toEqual([...ids].sort())
  })
})

describe('a worker that lost its job', () => {
  it('sends nothing (fence) and cannot reset the new owner’s run', async () => {
    const id = await job({ maxAttempts: 3 })
    await claimAutoResponseJobs('w1', 5)
    await db('auto_response_jobs')
      .where({ id })
      .update({ lockedAt: ago(2 * LEASE) }) // w1 stalls
    await reclaimStaleAutoResponseJobs(LEASE)
    await claimAutoResponseJobs('w2', 5) // recovery by the next worker

    const send = vi.fn(async () => ({ ok: true }))
    await expect(fencedSend(send, id, 'w1')({})).rejects.toBeInstanceOf(LeaseLostError)
    expect(send).not.toHaveBeenCalled()

    await failAutoResponseJob(id, 'late failure from w1', 'w1')
    expect(await row(id)).toMatchObject({ status: 'processing', lockedBy: 'w2', attempts: 2 })

    await fencedSend(send, id, 'w2')({})
    expect(send).toHaveBeenCalledTimes(1)
  })
})

describe('keepJobLease', () => {
  it('beats every lease/3 until stopped, and reports a lost lease', async () => {
    vi.useFakeTimers()
    try {
      const renew = vi.fn(async () => true)
      const lease = keepJobLease(1, 'w1', 30_000, { renew })
      await vi.advanceTimersByTimeAsync(30_000)
      expect(renew).toHaveBeenCalledTimes(3)
      renew.mockResolvedValue(false)
      await vi.advanceTimersByTimeAsync(10_000)
      expect(lease.lost()).toBe(true)
      lease.stop()
      await vi.advanceTimersByTimeAsync(30_000)
      expect(renew).toHaveBeenCalledTimes(4)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a transient renewal error does not throw or mark the lease lost', async () => {
    vi.useFakeTimers()
    try {
      const renew = vi.fn(async () => {
        throw new Error('db blip')
      })
      const lease = keepJobLease(1, 'w1', 30_000, { renew })
      await vi.advanceTimersByTimeAsync(10_000)
      expect(lease.lost()).toBe(false)
      lease.stop()
    } finally {
      vi.useRealTimers()
    }
  })
})
