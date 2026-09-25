import { describe, it, expect, afterAll, afterEach, vi } from 'vitest'
import { db } from '@/config/db'
import { isCardSetupEligible } from '@/lib/payments/cardTrial/startCardSetup'
import { billingSetupPurpose } from '@/lib/payments/cardTrial/availability'
import { scheduleDueTrialConversions, scheduleDueRenewals } from '@/db/payments/chargeScheduling'
import { seedAgency, seedMethod, seedSubscription, cleanupBilling, hoursFromNow } from './helpers/billingFixtures'

/**
 * A MANUALLY GRANTED PRO ACCOUNT WITH NO CARD ON FILE.
 *
 * The three purposes assumed a card exists (card_update), a trial is starting
 * (trial_start), or one expired and is being restored (reactivate). An account
 * that is PAID or LEGACY with no card matched none of them, so the billing
 * screen offered it nothing at all — which is precisely what agency 103
 * (plan 'pro', planReason 'manual:owner-comp') hit in production.
 *
 * The entitlement is the thing to protect here. Saving a card must leave the
 * comp exactly as it was: no subscription, no scheduled charge, no trial dates
 * touched.
 */

afterEach(async () => {
  vi.unstubAllEnvs()
  await cleanupBilling()
})
afterAll(async () => {
  await db.destroy()
})

/** plan 'pro' with a non-'grow:' reason is an admin grant: PAID, no expiry. */
const comped = () => seedAgency({ plan: 'pro', planReason: 'manual:owner-comp', trialStartedAt: hoursFromNow(-1800), trialEndsAt: hoursFromNow(-1632) })

describe('entitled account adding a first card', () => {
  it('is eligible for card_update even with no card on file', async () => {
    vi.stubEnv('CARD_REQUIRED_TRIAL_ENABLED', 'true')
    const agencyId = await comped()
    expect(await isCardSetupEligible(agencyId, 'card_update')).toBe(true)
    expect(await billingSetupPurpose(agencyId)) .toBe('card_update')
  })

  it('stays inside the rollout: not offered while the card flow is off for this agency', async () => {
    vi.stubEnv('CARD_REQUIRED_TRIAL_ENABLED', '')
    vi.stubEnv('CARD_TRIAL_PILOT_AGENCY_IDS', '')
    const agencyId = await comped()
    expect(await isCardSetupEligible(agencyId, 'card_update')).toBe(false)
    expect(await billingSetupPurpose(agencyId)).toBeNull()
  })

  it('is offered to the allowlisted pilot account specifically', async () => {
    vi.stubEnv('CARD_REQUIRED_TRIAL_ENABLED', '')
    const agencyId = await comped()
    vi.stubEnv('CARD_TRIAL_PILOT_AGENCY_IDS', String(agencyId))
    expect(await billingSetupPurpose(agencyId)).toBe('card_update')
  })

  it('does NOT steal the trial-conversion case: a trialing account with no card still gets trial_start', async () => {
    vi.stubEnv('CARD_REQUIRED_TRIAL_ENABLED', 'true')
    // TRIAL_ACTIVE with no card IS converting at ₪89 and must accept the
    // subscription terms, which card_update does not ask for.
    const agencyId = await seedAgency({ trialStartedAt: hoursFromNow(-24), trialEndsAt: hoursFromNow(120) })
    expect(await billingSetupPurpose(agencyId)).toBe('trial_start')
  })

  it('leaves replacement alone: an account WITH a card is still card_update', async () => {
    vi.stubEnv('CARD_REQUIRED_TRIAL_ENABLED', 'true')
    const agencyId = await seedAgency({ trialStartedAt: hoursFromNow(-24), trialEndsAt: hoursFromNow(120) })
    await seedMethod(agencyId)
    expect(await isCardSetupEligible(agencyId, 'card_update')).toBe(true)
  })
})

describe('the comp survives the card', () => {
  it('saving a card schedules no trial conversion — scheduling skips plan=pro', async () => {
    const agencyId = await comped()
    await seedMethod(agencyId)
    await seedSubscription(agencyId)
    await scheduleDueTrialConversions(50)
    expect(await db('billing_charges').where({ agencyId })).toHaveLength(0)
  })

  it('and no renewal — renewals follow a paid period a TOKEN charge started, not a manual grant', async () => {
    const agencyId = await comped()
    await seedMethod(agencyId)
    await seedSubscription(agencyId, { expiresAt: hoursFromNow(0.5) })
    await scheduleDueRenewals(50)
    expect(await db('billing_charges').where({ agencyId })).toHaveLength(0)
  })

  it('the entitlement and the historical trial dates are untouched', async () => {
    const agencyId = await comped()
    const before = await db('agencies').where({ id: agencyId }).first()
    await seedMethod(agencyId)
    await scheduleDueTrialConversions(50)
    const after = await db('agencies').where({ id: agencyId }).first()
    expect(after.plan).toBe('pro')
    expect(after.planReason).toBe('manual:owner-comp')
    expect(String(after.trialStartedAt)).toBe(String(before.trialStartedAt))
    expect(String(after.trialEndsAt)).toBe(String(before.trialEndsAt))
  })
})
