/**
 * actions/subscription — cancel/resume server-action tests.
 *
 * Mirrors the pattern from __tests__/payments-upgrade-route.test.ts:
 * mock requireAgencyUser, use the real DB for the subscriptions row.
 *
 * Both actions are admin-only (44749e4a): authorized cases act as an ADMIN.
 * Non-admin refusal is covered in __tests__/settings/phase2ActionGuards.test.ts;
 * the no-session and suspended refusals stay here.
 */
import { vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), cacheTag: vi.fn() }))
vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({ get: vi.fn(() => null), set: vi.fn(), delete: vi.fn() })),
  headers: vi.fn(() => ({ get: vi.fn(() => null) })),
}))
vi.mock('@/lib/requireUser', async () => {
  const actual = await vi.importActual<typeof import('@/lib/requireUser')>('@/lib/requireUser')
  return { ...actual, requireAgencyUser: vi.fn() }
})

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { db } from '@/config/db'
import { requireAgencyUser, AuthError } from '@/lib/requireUser'
import { Roles } from '@/types/roles'
import { cancelRenewal, resumeRenewal } from '@/actions/subscription'

const TEST_TAG = '__sub_actions_' + Date.now() + '_'
const created: number[] = []

async function seedAgencyWithSubscription(cancelAtPeriodEnd: boolean): Promise<number> {
  const [row] = await db('agencies').insert({ name: TEST_TAG + Math.random(), plan: 'pro' }).returning('id')
  const agencyId = typeof row === 'number' ? row : row.id
  created.push(agencyId)
  await db('subscriptions').insert({
    agencyId,
    planStartedAt: new Date(),
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    cancelAtPeriodEnd,
  })
  return agencyId
}

async function seedAgencyWithoutSubscription(): Promise<number> {
  const [row] = await db('agencies').insert({ name: TEST_TAG + Math.random(), plan: 'pro' }).returning('id')
  const agencyId = typeof row === 'number' ? row : row.id
  created.push(agencyId)
  return agencyId
}

afterAll(async () => {
  if (created.length) {
    await db('subscriptions').whereIn('agencyId', created).delete()
    await db('agencies').whereIn('id', created).delete()
  }
  await db.destroy()
})

beforeEach(() => {
  vi.mocked(requireAgencyUser).mockReset()
})

describe('cancelRenewal', () => {
  it('returns unauthorized when there is no session', async () => {
    vi.mocked(requireAgencyUser).mockRejectedValueOnce(new AuthError('no_session'))

    const result = await cancelRenewal()

    expect(result).toEqual({ error: 'unauthorized' })
  })

  it('returns unauthorized when user is suspended', async () => {
    vi.mocked(requireAgencyUser).mockRejectedValueOnce(new AuthError('suspended'))

    const result = await cancelRenewal()

    expect(result).toEqual({ error: 'unauthorized' })
  })

  it('returns no_subscription when the caller has no subscriptions row', async () => {
    const agencyId = await seedAgencyWithoutSubscription()
    vi.mocked(requireAgencyUser).mockResolvedValueOnce({ id: 1, agencyId, role: Roles.ADMIN } as any)

    const result = await cancelRenewal()

    expect(result).toEqual({ error: 'no_subscription' })

    // Critically — does not silently create a row.
    const row = await db('subscriptions').where({ agencyId }).first()
    expect(row).toBeUndefined()
  })

  it('sets cancelAtPeriodEnd=true and bumps updatedAt for an existing row', async () => {
    const agencyId = await seedAgencyWithSubscription(false)
    const before = await db('subscriptions').where({ agencyId }).first()
    vi.mocked(requireAgencyUser).mockResolvedValueOnce({ id: 1, agencyId, role: Roles.ADMIN } as any)

    await new Promise((r) => setTimeout(r, 10))

    const result = await cancelRenewal()
    expect(result).toEqual({ ok: true })

    const after = await db('subscriptions').where({ agencyId }).first()
    expect(after.cancelAtPeriodEnd).toBe(true)
    expect(new Date(after.updatedAt).getTime()).toBeGreaterThan(new Date(before.updatedAt).getTime())
  })

  it('is idempotent — applying cancel twice keeps cancelAtPeriodEnd=true', async () => {
    const agencyId = await seedAgencyWithSubscription(true)
    vi.mocked(requireAgencyUser).mockResolvedValueOnce({ id: 1, agencyId, role: Roles.ADMIN } as any)

    const result = await cancelRenewal()
    expect(result).toEqual({ ok: true })

    const row = await db('subscriptions').where({ agencyId }).first()
    expect(row.cancelAtPeriodEnd).toBe(true)
  })

  it('only mutates the callers own agencyId (scope check)', async () => {
    const myAgencyId = await seedAgencyWithSubscription(false)
    const otherAgencyId = await seedAgencyWithSubscription(false)
    vi.mocked(requireAgencyUser).mockResolvedValueOnce({ id: 1, agencyId: myAgencyId, role: Roles.ADMIN } as any)

    await cancelRenewal()

    const mine = await db('subscriptions').where({ agencyId: myAgencyId }).first()
    const others = await db('subscriptions').where({ agencyId: otherAgencyId }).first()

    expect(mine.cancelAtPeriodEnd).toBe(true)
    expect(others.cancelAtPeriodEnd).toBe(false)
  })
})

describe('resumeRenewal', () => {
  it('returns unauthorized when there is no session', async () => {
    vi.mocked(requireAgencyUser).mockRejectedValueOnce(new AuthError('no_session'))

    const result = await resumeRenewal()

    expect(result).toEqual({ error: 'unauthorized' })
  })

  it('sets cancelAtPeriodEnd=false for an existing row', async () => {
    const agencyId = await seedAgencyWithSubscription(true)
    vi.mocked(requireAgencyUser).mockResolvedValueOnce({ id: 1, agencyId, role: Roles.ADMIN } as any)

    const result = await resumeRenewal()
    expect(result).toEqual({ ok: true })

    const after = await db('subscriptions').where({ agencyId }).first()
    expect(after.cancelAtPeriodEnd).toBe(false)
  })

  it('returns no_subscription when no row exists', async () => {
    const agencyId = await seedAgencyWithoutSubscription()
    vi.mocked(requireAgencyUser).mockResolvedValueOnce({ id: 1, agencyId, role: Roles.ADMIN } as any)

    const result = await resumeRenewal()
    expect(result).toEqual({ error: 'no_subscription' })
  })

  it('is idempotent — applying resume twice keeps cancelAtPeriodEnd=false', async () => {
    const agencyId = await seedAgencyWithSubscription(false)
    vi.mocked(requireAgencyUser).mockResolvedValueOnce({ id: 1, agencyId, role: Roles.ADMIN } as any)

    const result = await resumeRenewal()
    expect(result).toEqual({ ok: true })

    const row = await db('subscriptions').where({ agencyId }).first()
    expect(row.cancelAtPeriodEnd).toBe(false)
  })
})
