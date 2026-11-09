/**
 * Credit-pack purchases through the EXISTING Grow token-charge pipeline.
 * Grow is a LOCAL MOCK; `dispatchAllowed: () => true` opens the evidence gate
 * for these tests only. No real charge, no payment transaction.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'crypto'
import { db } from '@/config/db'
import { purchaseCreditPack } from '@/lib/credits/purchase'
import { applySuccessfulCharge } from '@/lib/payments/charges/applySuccessfulCharge'
import { reconcileUnknownCharges } from '@/lib/payments/charges/reconcileUnknown'
import { claimDueCharges, mapCharge } from '@/db/payments/charges'
import { scheduleImmediateAttemptForOpenPeriod } from '@/db/payments/chargeScheduling'
import { agencyChargeFailure } from '@/db/payments/cardTrialEmails'
import { GrowTransportError } from '@/lib/payments/grow/http'
import type { ExecuteDeps } from '@/lib/payments/charges/executeCharge'
import type { TokenChargeResult } from '@/lib/payments/grow/api'
import { seedAgency, seedMethod, seedSubscription, cleanupBilling, hoursFromNow } from '../payments/helpers/billingFixtures'

function grow(result: TokenChargeResult | Error, dispatchAllowed = true): ExecuteDeps & { chargeToken: ReturnType<typeof vi.fn> } {
  return {
    chargeToken: vi.fn(async (): Promise<TokenChargeResult> => {
      if (result instanceof Error) throw result
      return result
    }),
    dispatchAllowed: () => dispatchAllowed,
  }
}
/** Grow's documented RETRYABLE decline: a subscription would be retried in days; a pack never is. */
const DECLINE: TokenChargeResult = { kind: 'grow_error', errorId: null, errorMessage: 'חברת האשראי לא אשרה את העסקה' }
const paid = (tx: string): TokenChargeResult => ({ kind: 'paid', transactionId: tx, transactionToken: 'tt', asmachta: '1', statusCode: '2' })

async function subscriber() {
  const agencyId = await seedAgency({ plan: 'pro', planReason: 'grow:seed-tx', trialStartedAt: hoursFromNow(-800), trialEndsAt: hoursFromNow(-600) })
  const pm = await seedMethod(agencyId)
  const expiresAt = hoursFromNow(24 * 20)
  await seedSubscription(agencyId, { expiresAt })
  sellPacksTo(agencyId)
  return { agencyId, pm, expiresAt }
}
/** Packs are sold only where credits are enforced. */
function sellPacksTo(agencyId: number) {
  process.env.CREDITS_METERING = '1'
  process.env.CREDITS_PURCHASES_AGENCY_IDS = String(agencyId)
  process.env.CREDITS_ENFORCEMENT_AGENCY_IDS = String(agencyId)
  process.env.CREDITS_ENFORCE_ON_PRO = '1'
}
const grants = (agencyId: number) => db('agency_credit_ledger').where({ agencyId, entryType: 'purchase_grant' }).select('amountMillis', 'idempotencyKey', 'sourceKind', 'sourceId')
const packCharges = (agencyId: number) => db('billing_charges').where({ agencyId }).whereNot('kind', 'trial_conversion').orderBy('id').select('*')

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})
afterEach(async () => {
  for (const k of ['CREDITS_PURCHASES_AGENCY_IDS', 'CREDITS_METERING', 'CREDITS_ENFORCEMENT_AGENCY_IDS', 'CREDITS_ENFORCEMENT_AGENCY_IDS', 'CREDITS_PACK_200_CREDITS', 'CREDITS_ENFORCE_ON_PRO']) delete process.env[k]
  vi.restoreAllMocks()
  await db.raw('TRUNCATE agency_credit_ledger')
  await cleanupBilling()
})
afterAll(async () => {
  await db.destroy()
})

describe('a paid pack', () => {
  it('grants its credits only after Grow confirms payment, and touches nothing about the subscription', async () => {
    const { agencyId, expiresAt } = await subscriber()
    const deps = grow(paid(`tx-pack-${agencyId}`))
    expect(await purchaseCreditPack({ agencyId, kind: 'credits_200', requestKey: randomUUID() }, deps)).toEqual({ state: 'granted' })
    expect(deps.chargeToken).toHaveBeenCalledTimes(1)
    expect(deps.chargeToken).toHaveBeenCalledWith(expect.objectContaining({ sum: 49, description: 'SocialCRM 200 קרדיטים' }))
    const [c] = await packCharges(agencyId)
    // Traceable: the grant names the charge that paid for it.
    expect(await grants(agencyId)).toEqual([{ amountMillis: '200000', idempotencyKey: `charge:${c.groupIdentifier}`, sourceKind: 'billing_charge', sourceId: String(c.id) }])
    expect(c).toMatchObject({ kind: 'credits_200', status: 'succeeded', billingPeriod: 'one_time', amount: '49.00' })
    // No paid period, no payments row, no change to the plan or renewal.
    expect(await db('payments').where({ agencyId }).count('* as n').first()).toMatchObject({ n: '0' })
    expect(new Date((await db('subscriptions').where({ agencyId }).first()).expiresAt).getTime()).toBe(expiresAt.getTime())
    expect(await db('agencies').where({ id: agencyId }).first()).toMatchObject({ plan: 'pro', planReason: 'grow:seed-tx' })
  })

  it('a duplicate success report (sync answer + reconcile, a replayed worker) never grants twice', async () => {
    const { agencyId } = await subscriber()
    await purchaseCreditPack({ agencyId, kind: 'credits_500', requestKey: randomUUID() }, grow(paid(`tx-dup-${agencyId}`)))
    const [c] = await packCharges(agencyId)
    expect(await applySuccessfulCharge(mapCharge(c), { transactionId: `tx-dup-${agencyId}`, transactionToken: null, asmachta: null, statusCode: '2' })).toEqual({ applied: false })
    expect(await grants(agencyId)).toHaveLength(1)
    expect((await grants(agencyId))[0].amountMillis).toBe('500000')
  })

  it('a double click (same request key) charges once', async () => {
    const { agencyId } = await subscriber()
    const key = randomUUID()
    const deps = grow(paid(`tx-dbl-${agencyId}`))
    await purchaseCreditPack({ agencyId, kind: 'credits_200', requestKey: key }, deps)
    expect(await purchaseCreditPack({ agencyId, kind: 'credits_200', requestKey: key }, deps)).toEqual({ state: 'already_granted' })
    expect(deps.chargeToken).toHaveBeenCalledTimes(1)
    expect(await packCharges(agencyId)).toHaveLength(1)
  })

  it('grants the amount it was SOLD with, even if the configuration changes before payment confirms', async () => {
    const { agencyId } = await subscriber()
    const deps = grow(paid(`tx-cfg-${agencyId}`))
    deps.chargeToken.mockImplementation(async () => {
      process.env.CREDITS_PACK_200_CREDITS = '999'
      return paid(`tx-cfg-${agencyId}`)
    })
    await purchaseCreditPack({ agencyId, kind: 'credits_200', requestKey: randomUUID() }, deps)
    expect((await grants(agencyId))[0].amountMillis).toBe('200000')
  })
})

describe('no credits without a confirmed payment, and nothing automatic', () => {
  it('a decline grants nothing, schedules no retry, and is not a subscription failure', async () => {
    const { agencyId } = await subscriber()
    const res = await purchaseCreditPack({ agencyId, kind: 'credits_200', requestKey: randomUUID() }, grow(DECLINE))
    expect(res.state).toBe('declined')
    expect(await grants(agencyId)).toEqual([])
    const rows = await packCharges(agencyId)
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('failed_retryable')
    expect(await agencyChargeFailure(agencyId)).toBeNull()
  })

  it('an unknown outcome grants nothing; reconciling it as not charged schedules nothing new', async () => {
    const { agencyId } = await subscriber()
    const res = await purchaseCreditPack({ agencyId, kind: 'credits_200', requestKey: randomUUID() }, grow(new GrowTransportError('timeout')))
    expect(res).toEqual({ state: 'pending_confirmation' })
    expect(await grants(agencyId)).toEqual([])
    await reconcileUnknownCharges(50, async () => ({ kind: 'not_charged' }))
    const rows = await packCharges(agencyId)
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('failed_retryable')
    expect(await grants(agencyId)).toEqual([])
  })

  it('with Grow dispatch unavailable the purchase is cancelled, so it can never be charged later', async () => {
    const { agencyId } = await subscriber()
    const deps = grow(paid('never'), false)
    expect(await purchaseCreditPack({ agencyId, kind: 'credits_200', requestKey: randomUUID() }, deps)).toEqual({ state: 'refused', reason: 'payments_unavailable' })
    expect(deps.chargeToken).not.toHaveBeenCalled()
    expect((await packCharges(agencyId))[0]).toMatchObject({ status: 'cancelled', errorClass: 'payments_unavailable' })
  })

  it('the scheduled charge pass never picks up a pack charge', async () => {
    const { agencyId, pm } = await subscriber()
    await db('billing_charges').insert({ agencyId, paymentMethodId: pm, kind: 'credits_200', periodKey: `credits:200:${randomUUID()}`, groupIdentifier: 1, attempt: 1, firstAttemptAt: new Date(), amount: 49, currency: 'ILS', billingPeriod: 'one_time', status: 'pending', nextAttemptAt: new Date() })
    expect(await claimDueCharges('test', 10, agencyId)).toEqual([])
  })

  it('a failed pack is never re-attempted by the subscription "card updated, retry now" path', async () => {
    const { agencyId, pm } = await subscriber()
    await purchaseCreditPack({ agencyId, kind: 'credits_200', requestKey: randomUUID() }, grow(DECLINE))
    expect(await db.transaction((trx) => scheduleImmediateAttemptForOpenPeriod(trx, agencyId, pm))).toBeNull()
    expect(await packCharges(agencyId)).toHaveLength(1)
  })
})

describe('who may buy', () => {
  it('only allowlisted agencies and only with a saved card', async () => {
    const { agencyId } = await subscriber()
    const deps = grow(paid(`tx-ai-${agencyId}`))
    delete process.env.CREDITS_PURCHASES_AGENCY_IDS
    expect(await purchaseCreditPack({ agencyId, kind: 'credits_200', requestKey: randomUUID() }, deps)).toEqual({ state: 'refused', reason: 'not_allowed' })
    expect(deps.chargeToken).not.toHaveBeenCalled()

    const other = await seedAgency({ plan: 'pro', planReason: 'manual:test' })
    sellPacksTo(other)
    expect(await purchaseCreditPack({ agencyId: other, kind: 'credits_200', requestKey: randomUUID() }, deps)).toEqual({ state: 'refused', reason: 'no_card' })
  })
})
