/**
 * What a one-time pack may NOT do: damage the subscription's card, double an
 * unconfirmed charge, or be sold where it buys nothing. Grow is a LOCAL MOCK.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'crypto'
import { db } from '@/config/db'
import { purchaseCreditPack } from '@/lib/credits/purchase'
import { reconcileUnknownCharges } from '@/lib/payments/charges/reconcileUnknown'
import { getActivePaymentMethod } from '@/db/payments/paymentMethods'
import { listPaidCreditPacks } from '@/db/credits/purchases'
import { mergeChargeHistory } from '@/lib/credits/chargeHistory'
import { GrowTransportError } from '@/lib/payments/grow/http'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/payments/grow/notify/route'
import type { ExecuteDeps } from '@/lib/payments/charges/executeCharge'
import type { TokenChargeResult } from '@/lib/payments/grow/api'
import { seedAgency, seedMethod, seedSubscription, cleanupBilling, hoursFromNow } from '../payments/helpers/billingFixtures'

vi.mock('@/lib/payments/grow/config', async (orig) => ({ ...(await orig<typeof import('@/lib/payments/grow/config')>()), assertGrowRuntime: () => ({ env: 'staging', mode: 'sandbox' }) }))

const ENV = ['CREDITS_METERING', 'CREDITS_PURCHASES_AGENCY_IDS', 'CREDITS_ENFORCEMENT_AGENCY_IDS']
const FINAL: TokenChargeResult = { kind: 'grow_error', errorId: null, errorMessage: 'כרטיס פג תוקף' }
const paid = (tx: string): TokenChargeResult => ({ kind: 'paid', transactionId: tx, transactionToken: 'tt', asmachta: '1', statusCode: '2' })
function grow(result: TokenChargeResult | Error): ExecuteDeps & { chargeToken: ReturnType<typeof vi.fn> } {
  return {
    chargeToken: vi.fn(async (): Promise<TokenChargeResult> => {
      if (result instanceof Error) throw result
      return result
    }),
    dispatchAllowed: () => true,
  }
}
function sellTo(agencyId: number) {
  process.env.CREDITS_METERING = '1'
  for (const k of ENV.slice(1)) process.env[k] = String(agencyId)
  process.env.CREDITS_ENFORCE_ON_PRO = '1'
}
async function subscriber() {
  const agencyId = await seedAgency({ plan: 'pro', planReason: 'grow:seed-tx', trialStartedAt: hoursFromNow(-800), trialEndsAt: hoursFromNow(-600) })
  const pm = await seedMethod(agencyId)
  await seedSubscription(agencyId, { expiresAt: hoursFromNow(24 * 20) })
  sellTo(agencyId)
  return { agencyId, pm }
}
const buy = (agencyId: number, deps: ExecuteDeps) => purchaseCreditPack({ agencyId, kind: 'credits_200', requestKey: randomUUID() }, deps)
const grants = (agencyId: number) => db('agency_credit_ledger').where({ agencyId, entryType: 'purchase_grant' }).select('amountMillis')
const packRows = (agencyId: number) => db('billing_charges').where({ agencyId }).whereNot('kind', 'trial_conversion').orderBy('id').select('*')

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})
afterEach(async () => {
  for (const k of ENV) delete process.env[k]
  delete process.env.CREDITS_ENFORCE_ON_PRO
  vi.restoreAllMocks()
  await db.raw('TRUNCATE agency_credit_ledger')
  await cleanupBilling()
})
afterAll(async () => {
  await db.destroy()
})

describe('a declined pack and the subscription card', () => {
  it('a FINAL decline leaves the saved card active, so the renewal is not silently stopped', async () => {
    const { agencyId, pm } = await subscriber()
    expect((await buy(agencyId, grow(FINAL))).state).toBe('declined')
    expect((await packRows(agencyId))[0]).toMatchObject({ status: 'failed_final', errorClass: 'final' })
    expect((await getActivePaymentMethod(agencyId))?.id).toBe(pm)
    expect(await db('agencies').where({ id: agencyId }).first()).toMatchObject({ plan: 'pro' })
  })

  it('after a final decline packs stop charging that card, until the card is replaced', async () => {
    const { agencyId, pm } = await subscriber()
    await buy(agencyId, grow(FINAL))
    const second = grow(paid(`tx-second-${agencyId}`))
    expect(await buy(agencyId, second)).toEqual({ state: 'refused', reason: 'card_declined' })
    expect(second.chargeToken).not.toHaveBeenCalled()

    await db('billing_payment_methods').where({ id: pm }).update({ status: 'replaced' })
    await seedMethod(agencyId)
    expect((await buy(agencyId, second)).state).toBe('granted')
  })
})

describe('an uncertain purchase cannot be doubled', () => {
  it('while one purchase is unconfirmed, a new request key is refused and Grow is not called', async () => {
    const { agencyId } = await subscriber()
    expect(await buy(agencyId, grow(new GrowTransportError('timeout')))).toEqual({ state: 'pending_confirmation' })
    const again = grow(paid(`tx-again-${agencyId}`))
    expect(await buy(agencyId, again)).toEqual({ state: 'refused', reason: 'purchase_pending' })
    expect(again.chargeToken).not.toHaveBeenCalled()
    expect(await packRows(agencyId)).toHaveLength(1)
  })

  it('reconciled as paid: exactly one grant, even if reconciliation runs again', async () => {
    const { agencyId } = await subscriber()
    await buy(agencyId, grow(new GrowTransportError('timeout')))
    const verdict = { kind: 'paid' as const, paid: { transactionId: `tx-rec-${agencyId}`, transactionToken: null, asmachta: null, statusCode: '2' } }
    await reconcileUnknownCharges(50, async () => verdict)
    await reconcileUnknownCharges(50, async () => verdict)
    expect(await grants(agencyId)).toEqual([{ amountMillis: '200000' }])
    expect((await packRows(agencyId))[0].status).toBe('succeeded')
  })

  it('reconciled as not charged: nothing granted, and buying is possible again', async () => {
    const { agencyId } = await subscriber()
    await buy(agencyId, grow(new GrowTransportError('timeout')))
    await reconcileUnknownCharges(50, async () => ({ kind: 'not_charged' }))
    expect(await grants(agencyId)).toEqual([])
    expect((await buy(agencyId, grow(paid(`tx-next-${agencyId}`)))).state).toBe('granted')
  })

  it('two concurrent purchases with different request keys reach Grow once', async () => {
    const { agencyId } = await subscriber()
    const deps = grow(paid(`tx-race-${agencyId}`))
    const results = await Promise.all([buy(agencyId, deps), buy(agencyId, deps)])
    expect(deps.chargeToken).toHaveBeenCalledTimes(1)
    expect(results.filter((r) => r.state === 'granted')).toHaveLength(1)
    expect(await grants(agencyId)).toHaveLength(1)
  })
})

describe('a pack is sold only where it does something', () => {
  it('a pack is refused where credits are not enforced', async () => {
    const { agencyId } = await subscriber()
    const deps = grow(paid('never'))
    delete process.env.CREDITS_ENFORCEMENT_AGENCY_IDS
    expect(await buy(agencyId, deps)).toEqual({ state: 'refused', reason: 'not_allowed' })
    expect(deps.chargeToken).not.toHaveBeenCalled()
  })
})

describe('only a Grow-confirmed payment adds credits', () => {
  it('an answer that is not the documented paid shape adds nothing', async () => {
    const { agencyId } = await subscriber()
    expect(await buy(agencyId, grow({ kind: 'unrecognized', statusCode: '1', transactionId: 'tx-maybe' }))).toEqual({ state: 'pending_confirmation' })
    expect(await grants(agencyId)).toEqual([])
  })

  it('a browser return or callback carrying the charge id adds nothing', async () => {
    const { agencyId } = await subscriber()
    await buy(agencyId, grow(new GrowTransportError('timeout')))
    const [c] = await packRows(agencyId)
    const body = new URLSearchParams({ status: '1', 'data[processId]': String(c.id), 'data[transactionId]': `tx-forged-${agencyId}`, 'data[statusCode]': '2', 'data[sum]': '49' })
    const res = await POST(new NextRequest('http://localhost/api/payments/grow/notify', { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded' } }))
    expect(res.status).toBeGreaterThanOrEqual(200)
    expect(await grants(agencyId)).toEqual([])
    expect((await packRows(agencyId))[0].status).toBe('unknown')
  })

  it('a trialling agency with a saved card and no subscription row can buy; nothing about a subscription is created', async () => {
    const agencyId = await seedAgency({ plan: 'free', trialStartedAt: hoursFromNow(-24), trialEndsAt: hoursFromNow(24 * 6) })
    await seedMethod(agencyId)
    sellTo(agencyId)
    const deps = grow(paid(`tx-trial-${agencyId}`))
    expect((await buy(agencyId, deps)).state).toBe('granted')
    expect(await db('subscriptions').where({ agencyId })).toEqual([])
  })

  it('a pack cannot be bought for another agency: the charge and grant follow the caller', async () => {
    const a = await subscriber()
    const other = await seedAgency({ plan: 'free' })
    sellTo(a.agencyId)
    await buy(a.agencyId, grow(paid(`tx-own-${a.agencyId}`)))
    expect(await grants(other)).toEqual([])
    expect(await grants(a.agencyId)).toHaveLength(1)
  })
})

describe('the charge history', () => {
  it('lists only Grow-confirmed packs, merged newest first with subscription payments', async () => {
    const { agencyId } = await subscriber()
    await buy(agencyId, grow(FINAL))
    await db('billing_payment_methods').where({ agencyId }).update({ status: 'replaced' })
    await seedMethod(agencyId)
    await buy(agencyId, grow(paid(`tx-hist-${agencyId}`)))
    const packs = await listPaidCreditPacks(agencyId)
    expect(packs).toHaveLength(1)
    expect(packs[0]).toMatchObject({ transactionId: `tx-hist-${agencyId}`, pack: { kind: 'credits_200', credits: 200, amount: 49 } })
    const older = { id: 1, transactionId: 'old', createdAt: new Date(Date.now() - 86_400_000) }
    expect(mergeChargeHistory([older], packs).map((c) => c.transactionId)).toEqual([`tx-hist-${agencyId}`, 'old'])
  })
})
