import { describe, it, expect, afterAll, afterEach } from 'vitest'
import { db } from '@/config/db'
import { getTrialState, hasActiveProductAccess } from '@/lib/trial'
import { scheduleDueTrialConversions } from '@/db/payments/chargeScheduling'
import { seedAgency, seedMethod, seedSubscription, seedCharge, cleanupBilling, hoursFromNow } from './helpers/billingFixtures'

/**
 * A CANCELLED TRIAL KEEPS ITS DAYS AND IS NEVER CHARGED FOR THEM.
 *
 * Production case, agency 157: the customer saved a real card, then cancelled
 * renewal mid-trial. Two promises are made on that screen — access runs to the
 * trial end, and no charge follows — and both land in the FUTURE, on
 * 2026-10-05T05:25:28.768Z. Nothing observable today proves either, which is
 * what these cover: the exact boundary, and the conversion pass at expiry.
 *
 * The live rows are only read elsewhere; nothing here touches them.
 */

const TRIAL_START = new Date('2026-09-28T05:25:28.768Z')
const TRIAL_END = new Date('2026-10-05T05:25:28.768Z')
const row = { trialStartedAt: TRIAL_START, trialEndsAt: TRIAL_END, plan: 'free' as const, planReason: null, trialExempt: false }

afterEach(cleanupBilling)
afterAll(async () => {
  await db.destroy()
})

describe('access across the exact expiry boundary', () => {
  it('a cancelled trial still has access one millisecond before the end', () => {
    const state = getTrialState(row, new Date(TRIAL_END.getTime() - 1))
    expect(state.status).toBe('TRIAL_ACTIVE')
    expect(hasActiveProductAccess(state.status)).toBe(true)
  })

  it('cancellation does not shorten it: the state is identical with and without a cancelled subscription', () => {
    // getTrialState reads the agency row only — cancelAtPeriodEnd lives on the
    // subscription and cannot pull the end date in. Pinned so a future "tidy
    // up on cancel" cannot quietly take days the customer already has.
    const mid = new Date(TRIAL_END.getTime() - 24 * 3600_000)
    expect(getTrialState(row, mid).status).toBe('TRIAL_ACTIVE')
    expect(getTrialState({ ...row }, mid).endsAt?.toISOString()).toBe(TRIAL_END.toISOString())
  })

  it('the boundary is EXCLUSIVE: at the instant itself, access has ended', () => {
    /*
     * getTrialState returns TRIAL_ACTIVE only while `now < endsAt`, so the last
     * millisecond of access is endsAt - 1ms. The conversion grace that can
     * extend this applies only while a conversion charge is in flight, and a
     * cancelled trial never has one — so for this account the end is exact.
     */
    expect(getTrialState(row, TRIAL_END).status).toBe('TRIAL_EXPIRED')
    expect(getTrialState({ ...row, conversionGraceEndsAt: null }, TRIAL_END).status).toBe('TRIAL_EXPIRED')
  })

  it('one millisecond after the end, access is gone', () => {
    const state = getTrialState(row, new Date(TRIAL_END.getTime() + 1))
    expect(state.status).toBe('TRIAL_EXPIRED')
    expect(hasActiveProductAccess(state.status)).toBe(false)
  })
})

describe('the conversion pass when a cancelled trial expires', () => {
  it('schedules NOTHING for it', async () => {
    const agencyId = await seedAgency({ trialStartedAt: hoursFromNow(-170), trialEndsAt: hoursFromNow(-1) })
    await seedMethod(agencyId)
    await seedSubscription(agencyId, { cancelAtPeriodEnd: true })

    await scheduleDueTrialConversions(50)

    expect(await db('billing_charges').where({ agencyId })).toHaveLength(0)
  })

  it('and the cancellation is the ONLY reason — the same trial uncancelled IS scheduled', async () => {
    const agencyId = await seedAgency({ trialStartedAt: hoursFromNow(-170), trialEndsAt: hoursFromNow(-1) })
    await seedMethod(agencyId)
    await seedSubscription(agencyId, { cancelAtPeriodEnd: false })

    await scheduleDueTrialConversions(50)

    // Without this the first case would pass for any unrelated missing
    // precondition and prove nothing about cancellation.
    expect(await db('billing_charges').where({ agencyId })).toHaveLength(1)
  })
})

describe('a charge queued before the cancellation', () => {
  it('is cancelled by the cancellation itself, not left pending', async () => {
    const agencyId = await seedAgency({ trialStartedAt: hoursFromNow(-170), trialEndsAt: hoursFromNow(-1) })
    const pm = await seedMethod(agencyId)
    await seedSubscription(agencyId, { cancelAtPeriodEnd: false })
    const chargeId = await seedCharge(agencyId, pm, { status: 'pending' })

    const { settleCardBillingOnCancel } = await import('@/db/payments/cancellation')
    await db.transaction(async (trx) => {
      await trx('subscriptions').where({ agencyId }).update({ cancelAtPeriodEnd: true })
      await settleCardBillingOnCancel(trx, agencyId)
    })

    expect(await db('billing_charges').where({ id: chargeId }).first()).toMatchObject({
      status: 'cancelled',
      errorClass: 'cancelled_by_customer',
      lockedAt: null,
      lockedBy: null,
    })
  })
})
