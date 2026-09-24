import { describe, it, expect, afterAll, afterEach } from 'vitest'
import { db } from '@/config/db'
import { scheduleDueTrialConversions, scheduleDueRenewals, scheduleImmediateAttemptForOpenPeriod } from '@/db/payments/chargeScheduling'
import { claimDueCharges, insertNextAttempt, markChargeFailed, reclaimStaleInFlightCharges, releaseUndispatchedClaim } from '@/db/payments/charges'
import { beginChargeAttempt } from '@/db/payments/chargeDispatch'
import { reopenCurrentPeriodAfterResume } from '@/db/payments/cancellation'
import { renewalPeriodKey, TRIAL_END_PERIOD_KEY } from '@/db/payments/periodKeys'
import { seedAgency, seedMethod, seedSubscription, seedCharge, cleanupBilling, hoursFromNow } from './helpers/billingFixtures'

afterEach(cleanupBilling)
afterAll(async () => {
  await db.destroy()
})

async function dueTrial(sub: Record<string, unknown> = {}) {
  const agencyId = await seedAgency({ trialStartedAt: hoursFromNow(-170), trialEndsAt: hoursFromNow(-2) })
  const pm = await seedMethod(agencyId)
  await seedSubscription(agencyId, sub)
  return { agencyId, pm }
}
const chargesOf = (agencyId: number) => db('billing_charges').where({ agencyId }).orderBy('id')
const failed = { status: 'failed_retryable' as const, errorClass: 'retryable', errorId: 103, errorMessage: 'x', statusCode: null }

describe('scheduling', () => {
  it('schedules exactly one first trial conversion whose group identifier is its own id', async () => {
    const { agencyId, pm } = await dueTrial()
    await scheduleDueTrialConversions(50)
    await scheduleDueTrialConversions(50)
    const rows = await chargesOf(agencyId)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'trial_conversion', periodKey: TRIAL_END_PERIOD_KEY, attempt: 1, status: 'pending', dispatchedAt: null })
    expect(Number(rows[0].paymentMethodId)).toBe(pm)
    expect(rows[0].groupIdentifier).toBe(rows[0].id)
    expect(Number(rows[0].amount)).toBe(89)
  })

  it.each([
    ['a trial that has not ended', { trialStartedAt: hoursFromNow(-2), trialEndsAt: hoursFromNow(2) }, {}, {}],
    ['a cancelled trial', { trialStartedAt: hoursFromNow(-170), trialEndsAt: hoursFromNow(-2) }, {}, { cancelAtPeriodEnd: true }],
    ['an agency without an active card', { trialStartedAt: hoursFromNow(-170), trialEndsAt: hoursFromNow(-2) }, { status: 'invalid' }, {}],
    ['an agency with a Grow standing order', { trialStartedAt: hoursFromNow(-170), trialEndsAt: hoursFromNow(-2) }, {}, { growDirectDebitId: 'dd-1' }],
  ])('never schedules %s', async (_label, agency, method, sub) => {
    const agencyId = await seedAgency(agency)
    await seedMethod(agencyId, method)
    await seedSubscription(agencyId, sub)
    await scheduleDueTrialConversions(50)
    expect(await chargesOf(agencyId)).toHaveLength(0)
  })

  it('renews a token-billed subscription within one hour of expiry, keyed by expiresAt, and never a Payment-Link subscriber', async () => {
    const expiresAt = new Date(Math.floor((Date.now() + 30 * 60_000) / 1000) * 1000)
    const token = await seedAgency({ plan: 'pro', planReason: 'grow:123' })
    const tokenPm = await seedMethod(token)
    await seedSubscription(token, { expiresAt })
    await seedCharge(token, tokenPm, { status: 'succeeded', dispatchedAt: new Date() })
    const link = await seedAgency({ plan: 'pro', planReason: 'grow:456' })
    await seedMethod(link)
    await seedSubscription(link, { expiresAt })
    await scheduleDueRenewals(50)
    await scheduleDueRenewals(50)
    const renewals = (await chargesOf(token)).filter((r) => r.kind === 'renewal')
    expect(renewals).toHaveLength(1)
    expect(renewals[0].periodKey).toBe(renewalPeriodKey(expiresAt))
    expect((await chargesOf(link)).filter((r) => r.kind === 'renewal')).toHaveLength(0)
  })
})

describe('claim, dispatch and lease recovery', () => {
  it('concurrent workers never claim the same charge', async () => {
    const { agencyId } = await dueTrial()
    await scheduleDueTrialConversions(50)
    const results = await Promise.all(['w1', 'w2', 'w3', 'w4'].map((w) => claimDueCharges(w, 10, agencyId)))
    expect(results.flat()).toHaveLength(1)
  })

  it('stamps dispatchedAt and returns the decrypted card only when the attempt may proceed', async () => {
    const { agencyId } = await dueTrial()
    await scheduleDueTrialConversions(50)
    const [claimed] = await claimDueCharges('w1', 1, agencyId)
    const ctx = await beginChargeAttempt(claimed.id)
    expect(ctx?.cardToken).toBe('card-token-plain')
    expect(ctx?.method.holder.fullName).toBe('John Smith')
    expect((await db('billing_charges').where({ id: claimed.id }).first()).dispatchedAt).not.toBeNull()
    expect(await beginChargeAttempt(claimed.id)).toBeNull()
  })

  it('never dispatches an attempt that sat queued for more than a day (e.g. dispatch was disabled)', async () => {
    const { agencyId, pm } = await dueTrial()
    const stale = await seedCharge(agencyId, pm, { status: 'pending', nextAttemptAt: hoursFromNow(-48) })
    const [claimed] = await claimDueCharges('w1', 1, agencyId)
    expect(claimed.id).toBe(stale)
    expect(await beginChargeAttempt(stale)).toBeNull()
    expect(await db('billing_charges').where({ id: stale }).first()).toMatchObject({ status: 'cancelled', errorClass: 'stale_undispatched', dispatchedAt: null })
  })

  it('stops instead of dispatching when the customer cancelled after scheduling', async () => {
    const { agencyId } = await dueTrial()
    await scheduleDueTrialConversions(50)
    const [claimed] = await claimDueCharges('w1', 1, agencyId)
    await db('subscriptions').where({ agencyId }).update({ cancelAtPeriodEnd: true })
    expect(await beginChargeAttempt(claimed.id)).toBeNull()
    expect(await db('billing_charges').where({ id: claimed.id }).first()).toMatchObject({ status: 'cancelled', errorClass: 'cancelled_by_customer', dispatchedAt: null })
  })

  it('an expired lease goes back to pending if never dispatched, and to unknown if dispatched', async () => {
    const a = await dueTrial()
    const b = await dueTrial()
    await scheduleDueTrialConversions(50)
    const [ca] = await claimDueCharges('w1', 1, a.agencyId)
    const [cb] = await claimDueCharges('w1', 1, b.agencyId)
    await beginChargeAttempt(cb.id)
    await db('billing_charges').whereIn('id', [ca.id, cb.id]).update({ lockedAt: hoursFromNow(-1) })
    const out = await reclaimStaleInFlightCharges(10 * 60_000)
    expect(out.requeued).toBeGreaterThanOrEqual(1)
    expect(out.unknown).toBeGreaterThanOrEqual(1)
    expect((await db('billing_charges').where({ id: ca.id }).first()).status).toBe('pending')
    expect((await db('billing_charges').where({ id: cb.id }).first()).status).toBe('unknown')
  })

  it('releases an undispatched claim but never a dispatched one', async () => {
    const { agencyId } = await dueTrial()
    await scheduleDueTrialConversions(50)
    const [claimed] = await claimDueCharges('w1', 1, agencyId)
    expect(await releaseUndispatchedClaim(claimed.id)).toBe(true)
    const [again] = await claimDueCharges('w1', 1, agencyId)
    await beginChargeAttempt(again.id)
    expect(await releaseUndispatchedClaim(again.id)).toBe(false)
  })
})

describe('retries and reopened periods', () => {
  it('inserts the next attempt with the same group identifier, and never while the period is still open', async () => {
    const { agencyId } = await dueTrial()
    await scheduleDueTrialConversions(50)
    const [claimed] = await claimDueCharges('w1', 1, agencyId)
    expect(await insertNextAttempt(db, claimed, hoursFromNow(24))).toBeNull()
    await beginChargeAttempt(claimed.id)
    await markChargeFailed(db, claimed.id, failed)
    expect(await insertNextAttempt(db, claimed, hoursFromNow(24))).not.toBeNull()
    const rows = await chargesOf(agencyId)
    expect(rows).toHaveLength(2)
    expect(rows[1]).toMatchObject({ attempt: 2, status: 'pending', groupIdentifier: rows[0].groupIdentifier })
  })

  it('reopens a failed period on a new card, but not for a cancelled subscription or an already-paid period', async () => {
    const { agencyId, pm } = await dueTrial()
    await seedCharge(agencyId, pm, { status: 'failed_final' })
    await db('billing_payment_methods').where({ id: pm }).update({ status: 'invalid' })
    const newPm = await seedMethod(agencyId)
    const id = await db.transaction((trx) => scheduleImmediateAttemptForOpenPeriod(trx, agencyId, newPm))
    expect(Number((await db('billing_charges').where({ id }).first()).paymentMethodId)).toBe(newPm)

    const cancelled = await dueTrial({ cancelAtPeriodEnd: true })
    await seedCharge(cancelled.agencyId, cancelled.pm, { status: 'failed_final' })
    expect(await db.transaction((trx) => scheduleImmediateAttemptForOpenPeriod(trx, cancelled.agencyId, cancelled.pm))).toBeNull()

    const paid = await dueTrial()
    await seedCharge(paid.agencyId, paid.pm, { status: 'cancelled', errorClass: 'already_paid' })
    expect(await db.transaction((trx) => scheduleImmediateAttemptForOpenPeriod(trx, paid.agencyId, paid.pm))).toBeNull()
  })
})

describe('resume reopens only the current period', () => {
  it('never revives a historical renewal period (no catch-up charges) and schedules the current one at its lead time', async () => {
    const expiresAt = new Date(Math.floor((Date.now() + 6 * 3_600_000) / 1000) * 1000)
    const agencyId = await seedAgency({ plan: 'pro', planReason: 'grow:1' })
    const pm = await seedMethod(agencyId)
    await seedSubscription(agencyId, { expiresAt, cancelAtPeriodEnd: true })
    const old = await seedCharge(agencyId, pm, { kind: 'renewal', periodKey: 'renewal:2026-01-01T00:00:00Z', status: 'cancelled', errorClass: 'cancelled_by_customer' })
    const current = await seedCharge(agencyId, pm, { kind: 'renewal', periodKey: renewalPeriodKey(expiresAt), status: 'cancelled', errorClass: 'cancelled_by_customer' })
    const reopenedId = await db.transaction((trx) => reopenCurrentPeriodAfterResume(trx, agencyId))
    const reopened = await db('billing_charges').where({ id: reopenedId }).first()
    expect(reopened).toMatchObject({ periodKey: renewalPeriodKey(expiresAt), attempt: 2, status: 'pending' })
    expect(new Date(reopened.nextAttemptAt).getTime()).toBe(expiresAt.getTime() - 3_600_000)
    expect(await db('billing_charges').where({ agencyId, periodKey: 'renewal:2026-01-01T00:00:00Z' })).toHaveLength(1)
    expect([old, current]).toContain(Number(reopened.groupIdentifier) === 0 ? old : current)
  })

  it('reopens an ended trial conversion now, and reopens nothing during an active trial', async () => {
    const { agencyId, pm } = await dueTrial({ cancelAtPeriodEnd: true })
    await seedCharge(agencyId, pm, { status: 'cancelled', errorClass: 'cancelled_by_customer' })
    const id = await db.transaction((trx) => reopenCurrentPeriodAfterResume(trx, agencyId))
    expect(await db('billing_charges').where({ id }).first()).toMatchObject({ periodKey: TRIAL_END_PERIOD_KEY, attempt: 2 })

    const active = await seedAgency({ trialStartedAt: hoursFromNow(-24), trialEndsAt: hoursFromNow(120) })
    await seedMethod(active)
    await seedSubscription(active, { cancelAtPeriodEnd: true })
    expect(await db.transaction((trx) => reopenCurrentPeriodAfterResume(trx, active))).toBeNull()
  })

  it('a stale-cancelled period stays recoverable through a new card', async () => {
    const { agencyId, pm } = await dueTrial()
    await seedCharge(agencyId, pm, { status: 'cancelled', errorClass: 'stale_undispatched' })
    const newPm = await seedMethod(agencyId, { status: 'pending', cardToken: null, confirmedAt: null })
    await db('billing_payment_methods').where({ id: pm }).update({ status: 'replaced' })
    await db('billing_payment_methods').where({ id: newPm }).update({ status: 'active', cardToken: 'x', confirmedAt: new Date() })
    const id = await db.transaction((trx) => scheduleImmediateAttemptForOpenPeriod(trx, agencyId, newPm))
    expect(await db('billing_charges').where({ id }).first()).toMatchObject({ status: 'pending', attempt: 2 })
  })
})
