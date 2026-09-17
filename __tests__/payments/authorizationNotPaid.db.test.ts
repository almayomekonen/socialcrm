import { describe, it, expect, afterAll, afterEach, vi } from 'vitest'
import { db } from '@/config/db'
import { executeCharge, type ExecuteDeps } from '@/lib/payments/charges/executeCharge'
import { scheduleDueTrialConversions } from '@/db/payments/chargeScheduling'
import { claimDueCharges } from '@/db/payments/charges'
import { chargeToken, type TokenChargeResult } from '@/lib/payments/grow/api'
import { interpretTokenLookup } from '@/lib/payments/grow/interpretTokenLookup'
import { seedAgency, seedMethod, seedSubscription, cleanupBilling, hoursFromNow } from './helpers/billingFixtures'

/**
 * AN AUTHORIZATION IS NOT A PAYMENT.
 *
 * Grow confirmed in writing that ApproveTransaction is not required for saving a
 * token without charging. What is NOT confirmed is whether a PRODUCTION account
 * can be configured so that createTransactionWithToken returns an authorization
 * awaiting capture instead of a completed charge. Our sandbox charge captured on
 * its own, but one sandbox account is not a promise about production.
 *
 * So the question is answered structurally instead of by trust: if such a
 * response ever arrives, can it become a paid month? These tests say no, at
 * every layer that could be fooled. statusCode 11 is the code Grow returns for
 * the ₪1 token-save hold — the closest thing we have observed to
 * "authorized, not captured" — so it stands in for that shape here.
 */

afterEach(cleanupBilling)
afterAll(async () => {
  await db.destroy()
})

const AUTHORIZED_NOT_CAPTURED = { asmachta: '131226262', status: 'ממתין', statusCode: 11, transactionId: 549236 }

describe('an authorization-shaped charge response', () => {
  it('is never read as paid by the API layer, even with a real transactionId', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ status: 1, err: '', data: AUTHORIZED_NOT_CAPTURED }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    )
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('GROW_MODE', 'sandbox')
    vi.stubEnv('GROW_USER_ID', 'user-1')
    vi.stubEnv('GROW_PAGE_CODE_TOKEN', 'page-1')
    try {
      const result = await chargeToken({
        cardToken: 'TOKEN-SECRET-VALUE',
        holder: { fullName: 'John Smith', phone: '0501234567', email: 'owner@example.com' },
        sum: 89,
        description: 'SocialCRM Pro מנוי חודשי',
        uniqueIdentifier: 1790000001,
      })
      // A transactionId is present and the envelope is fine. Only statusCode 2
      // means the money moved, so this is unknown — never paid, never declined.
      expect(result).toEqual({ kind: 'unrecognized', statusCode: '11', transactionId: '549236' })
    } finally {
      vi.unstubAllGlobals()
      vi.unstubAllEnvs()
    }
  })

  it('is never read as paid by reconciliation either', () => {
    const env = { status: 1, err: null, data: { transactions: [{ ...AUTHORIZED_NOT_CAPTURED, sum: '89' }] } }
    expect(interpretTokenLookup(env as never, { sum: 89 })).toEqual({
      kind: 'undetermined',
      reason: 'unobserved_status_code_11',
    })
  })

  it('does not grant a paid month: no subscription, no payments row, charge left for review', async () => {
    const agencyId = await seedAgency({ trialStartedAt: hoursFromNow(-170), trialEndsAt: hoursFromNow(-0.5) })
    await seedMethod(agencyId)
    await seedSubscription(agencyId)
    await scheduleDueTrialConversions(50)
    const [charge] = await claimDueCharges('test', 1, agencyId)

    const deps: ExecuteDeps = {
      chargeToken: async (): Promise<TokenChargeResult> => ({ kind: 'unrecognized', statusCode: '11', transactionId: '549236' }),
      dispatchAllowed: () => true,
    }
    expect(await executeCharge(charge.id, deps)).toBe('unknown')

    // The charge is parked, not settled and not retried: a second attempt could
    // charge a card that may already have been authorized.
    expect(await db('billing_charges').where({ id: charge.id }).first()).toMatchObject({
      status: 'unknown',
      errorClass: 'unrecognized_response',
    })
    // Nothing that would hand out access.
    expect(await db('payments').where({ agencyId })).toHaveLength(0)
    expect(await db('agencies').where({ id: agencyId }).first()).toMatchObject({ plan: 'free' })
    expect(await db('analytics_events').where({ agencyId, event: 'subscription_activated' })).toHaveLength(0)
  })
})
