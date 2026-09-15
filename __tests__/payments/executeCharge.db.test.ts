import { describe, it, expect, afterAll, afterEach, vi } from 'vitest'
import { db } from '@/config/db'
import { executeCharge, type ExecuteDeps } from '@/lib/payments/charges/executeCharge'
import { scheduleDueTrialConversions } from '@/db/payments/chargeScheduling'
import { claimDueCharges } from '@/db/payments/charges'
import { GrowTransportError } from '@/lib/payments/grow/http'
import type { TokenChargeResult } from '@/lib/payments/grow/api'
import { seedAgency, seedMethod, seedSubscription, cleanupBilling, hoursFromNow } from './helpers/billingFixtures'

afterEach(cleanupBilling)
afterAll(async () => {
  await db.destroy()
})

/**
 * Grow is a LOCAL MOCK throughout. `dispatchAllowed: () => true` opens the gate
 * for these tests only; the committed evidence gate stays closed.
 */
function charging(result: TokenChargeResult | Error, dispatchAllowed = true): ExecuteDeps & { chargeToken: ReturnType<typeof vi.fn> } {
  return {
    chargeToken: vi.fn(async (): Promise<TokenChargeResult> => {
      if (result instanceof Error) throw result
      return result
    }),
    dispatchAllowed: () => dispatchAllowed,
  }
}

async function claimedTrialCharge(sub: Record<string, unknown> = {}) {
  const agencyId = await seedAgency({ trialStartedAt: hoursFromNow(-170), trialEndsAt: hoursFromNow(-0.5) })
  const pm = await seedMethod(agencyId)
  await seedSubscription(agencyId, sub)
  await scheduleDueTrialConversions(50)
  const [charge] = await claimDueCharges('test', 1, agencyId)
  return { agencyId, pm, charge }
}
const chargeRow = (id: number) => db('billing_charges').where({ id }).first()
const paid = (agencyId: number): TokenChargeResult => ({ kind: 'paid', transactionId: `tx-${agencyId}`, transactionToken: 'tt', asmachta: '123', statusCode: '2' })

describe('executeCharge', () => {
  it('with dispatch not established: gives the claim back and sends nothing', async () => {
    const { charge } = await claimedTrialCharge()
    const deps = charging(paid(1), false)
    expect(await executeCharge(charge.id, deps)).toBe('dispatch_disabled')
    expect(deps.chargeToken).not.toHaveBeenCalled()
    expect(await chargeRow(charge.id)).toMatchObject({ status: 'pending', dispatchedAt: null })
  })

  it('a paid charge becomes a Model B paid period, once', async () => {
    const { agencyId, charge } = await claimedTrialCharge()
    const deps = charging(paid(agencyId))
    expect(await executeCharge(charge.id, deps)).toBe('succeeded')
    expect(deps.chargeToken).toHaveBeenCalledTimes(1)
    expect(deps.chargeToken).toHaveBeenCalledWith(expect.objectContaining({ cardToken: 'card-token-plain', sum: 89, uniqueIdentifier: charge.id, groupIdentifier: charge.groupIdentifier }))
    expect(await chargeRow(charge.id)).toMatchObject({ status: 'succeeded', providerTransactionId: `tx-${agencyId}` })
    expect(await db('agencies').where({ id: agencyId }).first()).toMatchObject({ plan: 'pro', planReason: `grow:tx-${agencyId}` })
    const sub = await db('subscriptions').where({ agencyId }).first()
    expect(new Date(sub.expiresAt).getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000)
    const events = await db('analytics_events').where({ agencyId }).whereIn('event', ['subscription_charge_succeeded', 'subscription_activated'])
    expect(events.map((e) => Object.keys(e.props).sort())).toEqual(expect.arrayContaining([['attempt', 'chargeId', 'kind'], ['kind', 'period', 'source']]))
  })

  it('keeps the customer cancellation when an already-dispatched charge succeeds', async () => {
    const { agencyId, charge } = await claimedTrialCharge()
    const deps = charging(paid(agencyId))
    deps.chargeToken.mockImplementation(async () => {
      await db('subscriptions').where({ agencyId }).update({ cancelAtPeriodEnd: true })
      return paid(agencyId)
    })
    expect(await executeCharge(charge.id, deps)).toBe('succeeded')
    expect((await db('subscriptions').where({ agencyId }).first()).cancelAtPeriodEnd).toBe(true)
  })

  it.each([
    ['a timeout', new GrowTransportError('timeout'), 'transport_timeout'],
    ['a connection reset', new GrowTransportError('network'), 'transport_network'],
    ['an unrecognized answer', { kind: 'unrecognized', statusCode: null, transactionId: null } as TokenChargeResult, 'unrecognized_response'],
    ['an unclassified Grow error (possibly a duplicate-identifier refusal)', { kind: 'grow_error', errorId: 140, errorMessage: 'לא ניתן לבצע תשלום עם טוקן, קוד מזהה טוקן אינו תקין' } as TokenChargeResult, 'grow_error_unclassified'],
  ])('%s is an UNKNOWN outcome: one request, no retry row, never a decline', async (_label, result, errorClass) => {
    const { agencyId, charge } = await claimedTrialCharge()
    const deps = charging(result)
    expect(await executeCharge(charge.id, deps)).toBe('unknown')
    expect(deps.chargeToken).toHaveBeenCalledTimes(1)
    expect(await chargeRow(charge.id)).toMatchObject({ status: 'unknown', errorClass })
    expect(await db('billing_charges').where({ agencyId })).toHaveLength(1)
    expect(await db('analytics_events').where({ agencyId, event: 'subscription_charge_failed' })).toHaveLength(0)
  })

  it('a documented final decline invalidates the card and schedules nothing', async () => {
    const { agencyId, pm, charge } = await claimedTrialCharge()
    expect(await executeCharge(charge.id, charging({ kind: 'grow_error', errorId: 103, errorMessage: 'כרטיס גנוב - עסקה לא מאושרת' }))).toBe('failed_final')
    expect((await db('billing_payment_methods').where({ id: pm }).first()).status).toBe('invalid')
    expect(await db('billing_charges').where({ agencyId })).toHaveLength(1)
    const [event] = await db('analytics_events').where({ agencyId, event: 'subscription_charge_failed' })
    expect(event.props).toMatchObject({ errorClass: 'final' })
    expect(JSON.stringify(event.props)).not.toContain('כרטיס')
  })

  it('a documented retryable decline schedules attempt 2 at +1 day with the same group identifier', async () => {
    const { agencyId, charge } = await claimedTrialCharge()
    expect(await executeCharge(charge.id, charging({ kind: 'grow_error', errorId: 103, errorMessage: 'חברת האשראי לא אשרה את העסקה' }))).toBe('failed_retryable')
    const rows = await db('billing_charges').where({ agencyId }).orderBy('id')
    expect(rows[1]).toMatchObject({ attempt: 2, status: 'pending', groupIdentifier: rows[0].groupIdentifier })
    expect(new Date(rows[1].nextAttemptAt).getTime()).toBe(new Date(rows[0].firstAttemptAt).getTime() + 86_400_000)
  })

  it('never calls Grow when the customer cancelled after the charge was claimed', async () => {
    const { agencyId, charge } = await claimedTrialCharge()
    await db('subscriptions').where({ agencyId }).update({ cancelAtPeriodEnd: true })
    const deps = charging(paid(agencyId))
    expect(await executeCharge(charge.id, deps)).toBe('skipped')
    expect(deps.chargeToken).not.toHaveBeenCalled()
  })

  it('settles a Grow transaction that is already recorded without a second extension', async () => {
    const { agencyId, charge } = await claimedTrialCharge()
    await db('payments').insert({ transactionId: `tx-${agencyId}`, agencyId })
    expect(await executeCharge(charge.id, charging(paid(agencyId)))).toBe('already_recorded')
    expect((await chargeRow(charge.id)).status).toBe('succeeded')
    expect((await db('agencies').where({ id: agencyId }).first()).plan).toBe('free')
  })
})
