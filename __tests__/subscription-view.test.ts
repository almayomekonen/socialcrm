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

async function seedAgency(plan: 'free' | 'pro', planReason?: string): Promise<number> {
  const [row] = await db('agencies').insert({ name: TEST_TAG + Math.random(), plan, ...(planReason ? { planReason } : {}) }).returning('id')
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
      billingPeriod: 'monthly',
      manageable: false,
      source: 'none',
    })
  })

  /*
   * AGENCY 103, THE CASE THIS EXISTS FOR.
   *
   * A manual Pro grant beside a leftover subscriptions row from the Payment
   * Links era — cancelAtPeriodEnd true, expiresAt in the past. Read as current
   * state, that row told the owner a cancellation had been received, that they
   * were paying ₪89 a month, and that access had already ended, all while they
   * held an open-ended comp. The row is history and must be left alone; it just
   * stops being mistaken for the present.
   */
  it('an explicit grant beside a stale subscription row reports the GRANT, not the row', async () => {
    const agencyId = await seedAgency('pro', 'manual:owner-comp')
    const expiredAt = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000)
    await db('subscriptions').insert({
      agencyId,
      planStartedAt: new Date(Date.now() - 34 * 24 * 60 * 60 * 1000),
      expiresAt: expiredAt,
      cancelAtPeriodEnd: true,
      billingPeriod: 'monthly',
    })

    const view = await getSubscriptionView(agencyId)

    expect(view.source).toBe('grant')
    expect(view.status).toBe('active')
    expect(view.cancelAtPeriodEnd).toBe(false)
    expect(view.expiresAt).toBeNull()
    expect(view.manageable).toBe(false)

    // The history itself is untouched.
    const row = await db('subscriptions').where({ agencyId }).first()
    expect(row.cancelAtPeriodEnd).toBe(true)
    expect(new Date(row.expiresAt).getTime()).toBe(expiredAt.getTime())
  })

  it('a grow-prepaid agency is still driven by its subscription row', async () => {
    const agencyId = await seedAgency('pro', 'grow:direct-debit')
    await db('subscriptions').insert({
      agencyId,
      planStartedAt: new Date(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      cancelAtPeriodEnd: true,
    })

    const view = await getSubscriptionView(agencyId)

    expect(view.source).toBe('subscription')
    expect(view.status).toBe('cancelling')
    expect(view.manageable).toBe(true)
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
