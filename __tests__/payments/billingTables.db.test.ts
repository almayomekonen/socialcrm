import { describe, it, expect, afterAll, afterEach } from 'vitest'
import { db } from '@/config/db'
import { seedAgency, seedMethod, seedCharge, cleanupBilling } from './helpers/billingFixtures'

afterEach(cleanupBilling)
afterAll(async () => {
  await db.destroy()
})

describe('billing_payment_methods', () => {
  it('allows only one active payment method per agency', async () => {
    const agencyId = await seedAgency()
    await seedMethod(agencyId)
    await expect(seedMethod(agencyId)).rejects.toMatchObject({ code: '23505' })
  })

  it('refuses an active payment method without a token', async () => {
    const agencyId = await seedAgency()
    await expect(seedMethod(agencyId, { cardToken: null })).rejects.toMatchObject({ code: '23514' })
  })

  it('requires recorded terms for a trial start or reactivation, not for a card replacement', async () => {
    const agencyId = await seedAgency()
    const noTerms = { status: 'pending', cardToken: null, confirmedAt: null, termsVersion: null, termsAcceptedAt: null }
    await expect(seedMethod(agencyId, { ...noTerms, purpose: 'trial_start' })).rejects.toMatchObject({ code: '23514' })
    await expect(seedMethod(agencyId, { ...noTerms, purpose: 'reactivate' })).rejects.toMatchObject({ code: '23514' })
    await expect(seedMethod(agencyId, { ...noTerms, purpose: 'card_update' })).resolves.toBeGreaterThan(0)
  })
})

describe('billing_charges', () => {
  it('starts charge ids above 1e9 so Grow unique identifiers are never reused after a rebuild', async () => {
    const agencyId = await seedAgency()
    const id = await seedCharge(agencyId, await seedMethod(agencyId))
    expect(id).toBeGreaterThan(1_000_000_000)
  })

  it('allows only one succeeded charge per agency and period', async () => {
    const agencyId = await seedAgency()
    const pm = await seedMethod(agencyId)
    await seedCharge(agencyId, pm, { status: 'succeeded', dispatchedAt: new Date() })
    await expect(seedCharge(agencyId, pm, { attempt: 2, status: 'succeeded', dispatchedAt: new Date() })).rejects.toMatchObject({ code: '23505' })
  })

  it('refuses a succeeded or unknown outcome for a charge that was never dispatched', async () => {
    const agencyId = await seedAgency()
    const pm = await seedMethod(agencyId)
    await expect(seedCharge(agencyId, pm, { status: 'succeeded' })).rejects.toMatchObject({ code: '23514' })
    await expect(seedCharge(agencyId, pm, { status: 'unknown' })).rejects.toMatchObject({ code: '23514' })
  })
})
