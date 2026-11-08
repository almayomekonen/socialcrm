/**
 * The customer's way through the purchase page, on the existing Grow card save
 * and token charge. Grow is a local mock; no card and no charge are real.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'crypto'
import { db } from '@/config/db'
import { Roles } from '@/types/roles'
import { admitAgentRequest, lastBlockedQuestion } from '@/db/credits/agentRequests'
import { getCreditBalanceView } from '@/lib/credits/balanceView'
import { purchaseCreditPack } from '@/lib/credits/purchase'
import { purchaseOutcome, whatsappReturnHref } from '@/lib/credits/purchaseOutcome'
import { isCardSetupEligible, startCardSetupForUser } from '@/lib/payments/cardTrial/startCardSetup'
import { GrowTransportError } from '@/lib/payments/grow/http'
import type { PackPurchaseRow } from '@/db/credits/purchases'
import { seedAgency, seedUser, seedMethod, cleanupBilling } from '../payments/helpers/billingFixtures'
import { recipient } from '../ownerWhatsappReminders/reminderFixtures'

const createTokenOnlyProcess = vi.fn()
const chargeToken = vi.fn()
const growDeps = { chargeToken, dispatchAllowed: () => true } as never
const consent = { purpose: 'card_update' as const, fullName: 'John Smith', phone: '050-123-4567', acceptedCardStorage: true }
const paid = () => ({ kind: 'paid' as const, transactionId: `tx-${randomUUID()}`, transactionToken: 'tt', asmachta: '1', statusCode: '2' })

async function comped() {
  const agencyId = await seedAgency({ plan: 'pro', planReason: 'manual:owner-comp' })
  const id = await seedUser(agencyId, Roles.ADMIN)
  return { id, agencyId, email: 'owner@example.com', role: Roles.ADMIN }
}
function pilot(agencyId: number) {
  process.env.CREDITS_METERING = '1'
  process.env.CREDITS_ENFORCEMENT_AGENCY_IDS = String(agencyId)
  process.env.CREDITS_PURCHASES_AGENCY_IDS = String(agencyId)
  process.env.CREDITS_ENFORCE_ON_PRO = '1'
}
const buy = (agencyId: number) => purchaseCreditPack({ agencyId, kind: 'credits_200', requestKey: randomUUID() }, growDeps)

beforeEach(() => {
  vi.stubEnv('APP_ENV', 'staging')
  vi.stubEnv('GROW_MODE', 'sandbox')
  vi.stubEnv('VERCEL_ENV', '')
  vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', '')
  vi.stubEnv('GROW_SANDBOX_ISOLATED_DATA', 'true')
  vi.stubEnv('GROW_USER_ID', 'user-1')
  vi.stubEnv('GROW_PAGE_CODE_TOKEN', 'page-1')
  vi.stubEnv('APP_HOST', 'staging.example.com')
  vi.stubEnv('CARD_REQUIRED_TRIAL_ENABLED', '')
  chargeToken.mockReset()
  createTokenOnlyProcess.mockReset()
  createTokenOnlyProcess.mockImplementation(async () => ({ processId: `proc-${randomUUID()}`, processToken: 'ptok', url: 'https://sandbox.meshulam.co.il/far?l=x' }))
})
afterEach(async () => {
  vi.unstubAllEnvs()
  for (const k of ['CREDITS_METERING', 'CREDITS_ENFORCEMENT_AGENCY_IDS', 'CREDITS_PURCHASES_AGENCY_IDS', 'CREDITS_ENFORCE_ON_PRO']) delete process.env[k]
  await db.raw('TRUNCATE agency_credit_ledger')
  await db('agent_requests').del()
  await cleanupBilling()
})
afterAll(async () => {
  await db.destroy()
})

describe('adding a card from the purchase page', () => {
  it('uses the existing Grow hosted save and comes back to the purchase page', async () => {
    const o = await comped()
    pilot(o.agencyId)
    expect(await startCardSetupForUser(o, { ...consent, returnTo: 'credits' }, { createTokenOnlyProcess })).toMatchObject({ ok: true })
    const sent = createTokenOnlyProcess.mock.calls[0][0]
    expect(sent.successUrl).toMatch(/\/billing\/success\?source=card_update&return=credits$/)
    expect(sent.cancelUrl).toMatch(/\/billing\/credits$/)
    expect(sent.notifyUrl).toMatch(/\/api\/payments\/grow\/notify$/)
  })

  it('leaves every other card setup exactly as it was', async () => {
    const o = await comped()
    pilot(o.agencyId)
    await startCardSetupForUser(o, consent, { createTokenOnlyProcess })
    const sent = createTokenOnlyProcess.mock.calls[0][0]
    expect(sent.successUrl).toMatch(/\/billing\/success\?source=card_update$/)
    expect(sent.cancelUrl).toMatch(/\/settings\/update_payment$/)
  })

  it('is open to the agency allowed to buy, and to no other card-less agency', async () => {
    const pilotAgency = await comped()
    const other = await comped()
    pilot(pilotAgency.agencyId)
    expect(await isCardSetupEligible(pilotAgency.agencyId, 'card_update')).toBe(true)
    expect(await isCardSetupEligible(other.agencyId, 'card_update')).toBe(false)
  })

  it('saving a card creates no charge and no subscription', async () => {
    const o = await comped()
    pilot(o.agencyId)
    await startCardSetupForUser(o, { ...consent, returnTo: 'credits' }, { createTokenOnlyProcess })
    expect(await db('billing_charges').where({ agencyId: o.agencyId })).toEqual([])
    expect(await db('subscriptions').where({ agencyId: o.agencyId })).toEqual([])
  })
})

describe('what the page knows', () => {
  it('no card, then a saved card: the page moves on to the packs', async () => {
    const o = await comped()
    pilot(o.agencyId)
    expect(await getCreditBalanceView(o.agencyId)).toMatchObject({ hasCard: false, cardDeclined: false, latestPurchase: null })
    await seedMethod(o.agencyId)
    const v = await getCreditBalanceView(o.agencyId)
    expect(v.hasCard).toBe(true)
    expect(v.packs).toHaveLength(2)
  })

  it('a Grow-confirmed purchase reads as success on every later visit, so a closed browser loses nothing', async () => {
    const o = await comped()
    pilot(o.agencyId)
    await seedMethod(o.agencyId)
    chargeToken.mockResolvedValue(paid())
    await buy(o.agencyId)
    expect((await getCreditBalanceView(o.agencyId)).latestPurchase).toEqual({ state: 'success', credits: 200 })
    expect((await getCreditBalanceView(o.agencyId)).purchasedAvailable).toBe(200)
  })

  it('an unconfirmed charge never reads as success', async () => {
    const o = await comped()
    pilot(o.agencyId)
    await seedMethod(o.agencyId)
    chargeToken.mockRejectedValue(new GrowTransportError('timeout'))
    await buy(o.agencyId)
    expect(await getCreditBalanceView(o.agencyId)).toMatchObject({ latestPurchase: { state: 'confirming' }, purchasedAvailable: 0 })
  })

  it('a declined card asks for a new one', async () => {
    const o = await comped()
    pilot(o.agencyId)
    await seedMethod(o.agencyId)
    chargeToken.mockResolvedValue({ kind: 'grow_error', errorId: null, errorMessage: 'כרטיס פג תוקף' })
    await buy(o.agencyId)
    expect(await getCreditBalanceView(o.agencyId)).toMatchObject({ cardDeclined: true, latestPurchase: { state: 'declined' } })
  })
})

describe('the blocked request', () => {
  async function blocked(o: { id: number; agencyId: number }, question: string) {
    const recipientId = await recipient(o.agencyId, o.id, `97250${Math.floor(1e6 + Math.random() * 8e6)}`, undefined, 'v5')
    const [j] = await db('wa_assistant_jobs').insert({ wamid: `wamid.mj.${randomUUID()}`, recipientId, agencyId: o.agencyId, userId: o.id, kind: 'text', question, messageTimestamp: Math.floor(Date.now() / 1000), status: 'answered' }).returning('id')
    process.env.CREDITS_MONTHLY_ALLOWANCE = '1'
    await admitAgentRequest({ agencyId: o.agencyId, userId: o.id, source: 'whatsapp', operation: { kind: 'wa_assistant_job', id: `free-${j.id}` } })
    await admitAgentRequest({ agencyId: o.agencyId, userId: o.id, source: 'whatsapp', operation: { kind: 'wa_assistant_job', id: String(j.id) } })
    delete process.env.CREDITS_MONTHLY_ALLOWANCE
  }

  it('is offered back as a draft to the same user, and to nobody else', async () => {
    const o = await comped()
    pilot(o.agencyId)
    await blocked(o, 'מי לא קיבל מענה?')
    expect(await lastBlockedQuestion(o.agencyId, o.id)).toBe('מי לא קיבל מענה?')
    expect(await lastBlockedQuestion(o.agencyId, o.id + 1)).toBeNull()
    const other = await comped()
    expect(await lastBlockedQuestion(other.agencyId, o.id)).toBeNull()
    await db('wa_assistant_jobs').where({ agencyId: o.agencyId }).del()
    await db('owner_whatsapp_recipients').where({ agencyId: o.agencyId }).del()
  })
})

describe('pure rules', () => {
  const row = (over: Partial<PackPurchaseRow>): PackPurchaseRow => ({ id: 1, kind: 'credits_200', credits: 200, amount: 49, status: 'succeeded', createdAt: new Date(1000), succeededAt: new Date(1000), ...over })
  it('success lasts a day, an open charge stays open, and anything else says nothing', () => {
    expect(purchaseOutcome(undefined, 0)).toBeNull()
    expect(purchaseOutcome(row({}), 2000)).toEqual({ state: 'success', credits: 200 })
    expect(purchaseOutcome(row({}), 1000 + 25 * 3_600_000)).toBeNull()
    expect(purchaseOutcome(row({ status: 'unknown', succeededAt: null }), 9e12)).toEqual({ state: 'confirming' })
    expect(purchaseOutcome(row({ status: 'cancelled', succeededAt: null }), 2000)).toBeNull()
  })
  it('the return link opens the chat and only drafts the text', () => {
    expect(whatsappReturnHref(null, 'x')).toBeNull()
    expect(whatsappReturnHref('972500000000', null)).toBe('https://wa.me/972500000000')
    expect(whatsappReturnHref('972500000000', 'מי ענה?')).toBe(`https://wa.me/972500000000?text=${encodeURIComponent('מי ענה?')}`)
  })
})
