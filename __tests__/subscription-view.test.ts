import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { db } from '@/config/db'
import { deriveStatus, getSubscriptionView } from '@/lib/quota/subscription'

describe('deriveStatus (pure)', () => {
  it('returns inactive for free users regardless of cancel flag', () => {
    expect(deriveStatus('free', false)).toBe('inactive')
    expect(deriveStatus('free', true)).toBe('inactive')
  })

  it('returns cancelling when pro and cancelAtPeriodEnd', () => {
    expect(deriveStatus('pro', true)).toBe('cancelling')
  })

  it('returns active when pro and not cancelling', () => {
    expect(deriveStatus('pro', false)).toBe('active')
  })
})

const TEST_TAG = '__sub_view_' + Date.now() + '_'
const created: number[] = []

async function seedAgency(plan: 'free' | 'pro'): Promise<number> {
  const [row] = await db('agencies').insert({ name: TEST_TAG + Math.random(), plan }).returning('id')
  const id = typeof row === 'number' ? row : row.id
  created.push(id)
  return id
}

afterAll(async () => {
  if (created.length) {
    await db('subscriptions').whereIn('agencyId', created).delete()
    await db('agencies').whereIn('id', created).delete()
  }
  await db.destroy()
})

describe('getSubscriptionView (db)', () => {
  it('returns manageable=false when no subscriptions row exists', async () => {
    const agencyId = await seedAgency('pro')

    const view = await getSubscriptionView(agencyId)

    expect(view).toEqual({
      plan: 'pro',
      expiresAt: null,
      cancelAtPeriodEnd: false,
      status: 'active',
      manageable: false,
    })
  })

  it('returns manageable=true with row data when a subscriptions row exists', async () => {
    const agencyId = await seedAgency('pro')
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    await db('subscriptions').insert({
      agencyId,
      planStartedAt: new Date(),
      expiresAt,
      cancelAtPeriodEnd: false,
    })

    const view = await getSubscriptionView(agencyId)

    expect(view.plan).toBe('pro')
    expect(view.cancelAtPeriodEnd).toBe(false)
    expect(view.status).toBe('active')
    expect(view.manageable).toBe(true)
    expect(view.expiresAt).not.toBeNull()
    expect(view.expiresAt!.getTime()).toBe(expiresAt.getTime())
  })

  it('reflects status=cancelling when cancelAtPeriodEnd is true on the row', async () => {
    const agencyId = await seedAgency('pro')
    await db('subscriptions').insert({
      agencyId,
      planStartedAt: new Date(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      cancelAtPeriodEnd: true,
    })

    const view = await getSubscriptionView(agencyId)

    expect(view.status).toBe('cancelling')
    expect(view.cancelAtPeriodEnd).toBe(true)
    expect(view.manageable).toBe(true)
  })

  it('returns status=inactive for free plan even if a row exists', async () => {
    const agencyId = await seedAgency('free')
    await db('subscriptions').insert({
      agencyId,
      planStartedAt: new Date(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      cancelAtPeriodEnd: false,
    })

    const view = await getSubscriptionView(agencyId)

    expect(view.plan).toBe('free')
    expect(view.status).toBe('inactive')
  })
})
