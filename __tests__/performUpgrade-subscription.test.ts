/**
 * performAgencyUpgrade — subscriptions upsert behavior.
 *
 * Asserts the new write path adds/updates a row in `subscriptions` with the
 * right shape, that createdAt is preserved across renewals, and that webhook
 * idempotency (duplicate transactionId) does NOT extend expiresAt — the
 * shared db.transaction() rolls back the upsert when payments raises 23505.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { db } from '@/config/db'
import { performAgencyUpgrade } from '@/lib/quota/performUpgrade'
import { SUBSCRIPTION_PERIOD_DAYS } from '@/lib/quota/constants'

const TEST_TAG = '__sub_upgrade_' + Date.now() + '_'
const created: number[] = []

async function seedAgency(): Promise<number> {
  const [row] = await db('agencies').insert({ name: TEST_TAG + Math.random() }).returning('id')
  const agencyId = typeof row === 'number' ? row : row.id
  created.push(agencyId)
  return agencyId
}

afterAll(async () => {
  if (created.length) {
    await db('subscriptions').whereIn('agencyId', created).delete()
    await db('payments').whereIn('agencyId', created).delete()
    await db('agencies').whereIn('id', created).delete()
  }
  await db.destroy()
})

describe('performAgencyUpgrade — subscriptions upsert', () => {
  it('inserts a subscriptions row with the right shape on first upgrade', async () => {
    const agencyId = await seedAgency()

    const before = Date.now()
    const result = await performAgencyUpgrade(agencyId, 'grow:tx-test-1')
    const after = Date.now()

    expect(result).toEqual({ success: true })

    const row = await db('subscriptions').where({ agencyId }).first()
    expect(row).toBeTruthy()
    expect(row.cancelAtPeriodEnd).toBe(false)

    const planStartedAt = new Date(row.planStartedAt).getTime()
    expect(planStartedAt).toBeGreaterThanOrEqual(before)
    expect(planStartedAt).toBeLessThanOrEqual(after)

    const expiresAt = new Date(row.expiresAt).getTime()
    const expectedExpires = planStartedAt + SUBSCRIPTION_PERIOD_DAYS * 24 * 60 * 60 * 1000
    expect(expiresAt).toBe(expectedExpires)
  })

  it('preserves createdAt across renewals and resets cancelAtPeriodEnd', async () => {
    const agencyId = await seedAgency()

    await performAgencyUpgrade(agencyId, 'grow:tx-test-2a')
    const first = await db('subscriptions').where({ agencyId }).first()
    const originalCreatedAt = first.createdAt

    // Simulate the user having cancelled in between purchases.
    await db('subscriptions').where({ agencyId }).update({ cancelAtPeriodEnd: true })

    // Wait briefly so the new updatedAt is strictly greater.
    await new Promise((r) => setTimeout(r, 10))

    await performAgencyUpgrade(agencyId, 'grow:tx-test-2b')
    const second = await db('subscriptions').where({ agencyId }).first()

    expect(new Date(second.createdAt).getTime()).toBe(new Date(originalCreatedAt).getTime())
    expect(second.cancelAtPeriodEnd).toBe(false)
    expect(new Date(second.updatedAt).getTime()).toBeGreaterThan(new Date(first.updatedAt).getTime())
    expect(new Date(second.planStartedAt).getTime()).toBeGreaterThan(new Date(first.planStartedAt).getTime())
  })

  it('webhook idempotency: a duplicate transactionId does NOT extend expiresAt', async () => {
    // Mirrors the production code path: payments insert + performAgencyUpgrade
    // both run inside the same transaction. A duplicate transactionId raises
    // 23505 on the payments insert and rolls back the subscriptions upsert too.
    const agencyId = await seedAgency()
    const transactionId = 'tx-idempotency-' + Date.now()

    // First delivery — succeeds.
    await db.transaction(async (trx) => {
      await trx('payments').insert({ transactionId, agencyId })
      const r = await performAgencyUpgrade(agencyId, `grow:${transactionId}`, trx)
      if ('error' in r) throw new Error('first delivery should succeed')
    })

    const afterFirst = await db('subscriptions').where({ agencyId }).first()
    const originalExpiresAt = new Date(afterFirst.expiresAt).getTime()
    const originalUpdatedAt = new Date(afterFirst.updatedAt).getTime()

    // Wait so any rogue update would produce a different value.
    await new Promise((r) => setTimeout(r, 25))

    // Second delivery with the same transactionId — must roll back.
    let caughtCode: string | undefined
    try {
      await db.transaction(async (trx) => {
        await trx('payments').insert({ transactionId, agencyId })
        await performAgencyUpgrade(agencyId, `grow:${transactionId}`, trx)
      })
    } catch (err: any) {
      caughtCode = err?.code
    }

    expect(caughtCode).toBe('23505')

    const afterSecond = await db('subscriptions').where({ agencyId }).first()
    expect(new Date(afterSecond.expiresAt).getTime()).toBe(originalExpiresAt)
    expect(new Date(afterSecond.updatedAt).getTime()).toBe(originalUpdatedAt)
  })
})
