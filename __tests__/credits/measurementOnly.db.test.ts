/**
 * Proof of the release posture: with exactly the measurement-only flags set,
 * nothing is enforced, nothing is sold, and Grow is never called.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'fs'
import { randomUUID } from 'crypto'
import { db } from '@/config/db'
import { admitAgentRequest, settleAgentRequests } from '@/db/credits/agentRequests'
import { getCreditBalanceView } from '@/lib/credits/balanceView'
import { canPurchaseCredits, canSeeCreditBalance, isCreditEnforcedFor, isPackSellable } from '@/lib/credits/config'
import { purchaseCreditPack } from '@/lib/credits/purchase'
import { seedAgency, seedMethod, seedSubscription, cleanupBilling, hoursFromNow } from '../payments/helpers/billingFixtures'
import { seedOwner } from '../reminders/fixtures'

const chargeToken = vi.fn()
const deps = { chargeToken, dispatchAllowed: () => true } as never

beforeEach(() => {
  chargeToken.mockReset()
  process.env.CREDITS_METERING = '1'
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(async () => {
  for (const k of ['CREDITS_METERING', 'CREDITS_UI_AGENCY_IDS', 'CREDITS_PURCHASES_AGENCY_IDS', 'CREDITS_MONTHLY_ALLOWANCE']) delete process.env[k]
  vi.restoreAllMocks()
  await db.raw('TRUNCATE agency_credit_ledger')
  await cleanupBilling()
})
afterAll(async () => {
  await db.destroy()
})

describe('measurement-only flags (CREDITS_METERING=1, CREDITS_UI_AGENCY_IDS=<id>)', () => {
  it('requests past the allowance refuse nothing, and the view offers nothing to buy', async () => {
    process.env.CREDITS_MONTHLY_ALLOWANCE = '1'
    const o = await seedOwner('mo-neg')
    await db('agencies').where({ id: o.agencyId }).update({ plan: 'pro', planReason: 'manual:test' })
    process.env.CREDITS_UI_AGENCY_IDS = String(o.agencyId)
    for (const id of ['1', '2', '3']) expect(await admitAgentRequest({ agencyId: o.agencyId, userId: o.userId, source: 'whatsapp', operation: { kind: 'wa_assistant_job', id } })).toMatchObject({ allowed: true })
    expect(isCreditEnforcedFor(o.agencyId, 'pro')).toBe(false)
    expect(canSeeCreditBalance(o.agencyId)).toBe(true)
    expect(canPurchaseCredits(o.agencyId)).toBe(false)
    expect(await getCreditBalanceView(o.agencyId)).toMatchObject({ enforced: false, canPurchase: false, packs: [] })
    expect(await db('agency_credit_ledger').where({ agencyId: o.agencyId })).toEqual([])
    expect(await db('agent_requests').where({ agencyId: o.agencyId, enforced: true })).toEqual([])
  })

  it('a purchase is refused before any row or Grow call, for a subscriber with a saved card', async () => {
    const agencyId = await seedAgency({ plan: 'pro', planReason: 'grow:seed-tx', trialStartedAt: hoursFromNow(-800), trialEndsAt: hoursFromNow(-600) })
    await seedMethod(agencyId)
    await seedSubscription(agencyId, { expiresAt: hoursFromNow(24 * 20) })
    expect(await purchaseCreditPack({ agencyId, kind: 'credits_200', requestKey: randomUUID() }, deps)).toEqual({ state: 'refused', reason: 'not_allowed' })
    process.env.CREDITS_PURCHASES_AGENCY_IDS = String(agencyId)
    expect(isPackSellable(agencyId, 'pro')).toBe(false)
    expect(await purchaseCreditPack({ agencyId, kind: 'credits_500', requestKey: randomUUID() }, deps)).toEqual({ state: 'refused', reason: 'not_allowed' })
    expect(chargeToken).not.toHaveBeenCalled()
    expect(await db('billing_charges').where({ agencyId }).whereIn('kind', ['credits_200', 'credits_500'])).toEqual([])
  })
})

describe('flags are off by default', () => {
  it('with nothing set, the cron and every gate are inert', async () => {
    delete process.env.CREDITS_METERING
    expect(isCreditEnforcedFor(103, 'free')).toBe(false)
    expect(canPurchaseCredits(103)).toBe(false)
    expect(canSeeCreditBalance(103)).toBe(false)
    expect(await settleAgentRequests()).toEqual({ settled: 0, exempt: 0, unpriced: 0, voided: 0, skipped: 0 })
  })
  it('deployment configuration sets no CREDITS_ value', () => {
    expect(readFileSync('vercel.json', 'utf8')).not.toContain('CREDITS_')
  })
})
