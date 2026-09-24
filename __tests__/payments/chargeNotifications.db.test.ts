import { describe, it, expect, afterAll, afterEach, beforeEach, vi } from 'vitest'

vi.mock('@/lib/emailAutomations/live', () => ({ dispatchLifecycleEvent: vi.fn(async () => 'sent') }))

import { db } from '@/config/db'
import { executeCharge, type ExecuteDeps } from '@/lib/payments/charges/executeCharge'
import { scheduleDueTrialConversions } from '@/db/payments/chargeScheduling'
import { claimDueCharges } from '@/db/payments/charges'
import { agencyChargeFailure } from '@/db/payments/cardTrialEmails'
import { dispatchLifecycleEvent } from '@/lib/emailAutomations/live'
import type { TokenChargeResult } from '@/lib/payments/grow/api'
import { seedAgency, seedUser, seedMethod, seedSubscription, seedCharge, cleanupBilling, hoursFromNow } from './helpers/billingFixtures'

/**
 * What the customer is told when a token charge lands or fails. Grow is a local
 * mock and the email dispatcher is mocked — this asserts WHICH event fires and
 * when, not that any mail was delivered.
 */

// mockReset, not mockClear: a queued `…Once` rejection that a test never
// consumes would otherwise leak into the next one and fail it for no reason.
beforeEach(() => {
  vi.mocked(dispatchLifecycleEvent).mockReset()
  vi.mocked(dispatchLifecycleEvent).mockImplementation(async () => 'sent' as never)
})
afterEach(cleanupBilling)
afterAll(async () => {
  await db.destroy()
})

function charging(result: TokenChargeResult): ExecuteDeps {
  return { chargeToken: vi.fn(async () => result), dispatchAllowed: () => true }
}
const paid: TokenChargeResult = { kind: 'paid', transactionId: 'tx-notify', transactionToken: 'tt', asmachta: '1', statusCode: '2' }
/** 451 is a documented FINAL-only id; the retryable row is matched by its documented message. */
const declined = (errorId: number, msg: string): TokenChargeResult => ({ kind: 'grow_error', errorId, errorMessage: msg })
const RETRYABLE_MESSAGE = 'חברת האשראי לא אשרה את העסקה'

async function claimedCharge() {
  const agencyId = await seedAgency({ trialStartedAt: hoursFromNow(-170), trialEndsAt: hoursFromNow(-0.5) })
  await seedUser(agencyId)
  const pm = await seedMethod(agencyId)
  await seedSubscription(agencyId)
  await scheduleDueTrialConversions(50)
  const [charge] = await claimDueCharges('test', 1, agencyId)
  return { agencyId, pm, charge }
}
const events = () => vi.mocked(dispatchLifecycleEvent).mock.calls.map((c) => c[0])

describe('charge lifecycle notifications', () => {
  it('thanks the customer after a successful token charge, exactly as the Payment-Link path does', async () => {
    const { charge } = await claimedCharge()
    expect(await executeCharge(charge.id, charging(paid))).toBe('succeeded')
    expect(events()).toEqual(['subscription.activated'])
  })

  it('tells the customer when the card was declined — final and retryable alike', async () => {
    const a = await claimedCharge()
    expect(await executeCharge(a.charge.id, charging(declined(451, 'stolen card')))).toBe('failed_final')
    expect(events()).toEqual(['subscription.payment_failed'])

    vi.mocked(dispatchLifecycleEvent).mockReset()
    vi.mocked(dispatchLifecycleEvent).mockImplementation(async () => 'sent' as never)
    const b = await claimedCharge()
    expect(await executeCharge(b.charge.id, charging(declined(103, RETRYABLE_MESSAGE)))).toBe('failed_retryable')
    expect(events()).toEqual(['subscription.payment_failed'])
  })

  it('never announces an outcome it does not know', async () => {
    const { charge } = await claimedCharge()
    expect(await executeCharge(charge.id, charging({ kind: 'unrecognized', statusCode: '99', transactionId: 'tx-unknown' }))).toBe('unknown')
    expect(events()).toEqual([])
  })

  it('does not let a failed email undo a settled charge', async () => {
    vi.mocked(dispatchLifecycleEvent).mockRejectedValueOnce(new Error('resend down'))
    const { charge } = await claimedCharge()
    expect(await executeCharge(charge.id, charging(declined(451, 'stolen card')))).toBe('failed_final')
    expect((await db('billing_charges').where({ id: charge.id }).first()).status).toBe('failed_final')

    vi.mocked(dispatchLifecycleEvent).mockRejectedValueOnce(new Error('resend down'))
    const ok = await claimedCharge()
    expect(await executeCharge(ok.charge.id, charging({ ...paid, transactionId: 'tx-guarded' }))).toBe('succeeded')
    expect((await db('billing_charges').where({ id: ok.charge.id }).first()).status).toBe('succeeded')
  })
})

describe('agencyChargeFailure — what the failure email is allowed to say', () => {
  async function agencyWithFailure(chargeOver: Record<string, unknown>, subOver: Record<string, unknown> = {}) {
    const agencyId = await seedAgency()
    const pm = await seedMethod(agencyId)
    await seedSubscription(agencyId, subOver)
    await seedCharge(agencyId, pm, { periodKey: 'trial_end', attempt: 1, dispatchedAt: new Date(), ...chargeOver })
    return { agencyId, pm }
  }

  it('names the automatic retry date while attempts remain', async () => {
    const at = hoursFromNow(24)
    const { agencyId, pm } = await agencyWithFailure({ status: 'failed_retryable', errorClass: 'retryable' })
    await seedCharge(agencyId, pm, { periodKey: 'trial_end', attempt: 2, status: 'pending', nextAttemptAt: at })
    const notice = await agencyChargeFailure(agencyId)
    expect(notice).toMatchObject({ periodKey: 'trial_end', final: false })
    expect(notice?.nextAttemptAt?.toISOString().slice(0, 10)).toBe(at.toISOString().slice(0, 10))
  })

  it('asks for a new card once nothing is left to try', async () => {
    const { agencyId } = await agencyWithFailure({ status: 'failed_final', errorClass: 'final' })
    expect(await agencyChargeFailure(agencyId)).toMatchObject({ final: true, nextAttemptAt: null })
  })

  it('says nothing to a customer who cancelled', async () => {
    const { agencyId } = await agencyWithFailure({ status: 'failed_final', errorClass: 'final' }, { cancelAtPeriodEnd: true })
    expect(await agencyChargeFailure(agencyId)).toBeNull()
  })

  it('says nothing once a later attempt paid the period', async () => {
    const { agencyId, pm } = await agencyWithFailure({ status: 'failed_retryable', errorClass: 'retryable' })
    await seedCharge(agencyId, pm, {
      periodKey: 'trial_end', attempt: 2, status: 'succeeded', dispatchedAt: new Date(),
      succeededAt: new Date(), providerTransactionId: 'tx-late-success',
    })
    expect(await agencyChargeFailure(agencyId)).toBeNull()
  })

  it('says nothing when there is no failure at all', async () => {
    const agencyId = await seedAgency()
    await seedSubscription(agencyId)
    expect(await agencyChargeFailure(agencyId)).toBeNull()
  })
})
