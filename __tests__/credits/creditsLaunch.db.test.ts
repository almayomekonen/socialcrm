/**
 * Subscription + AI credits for EVERY agency (launch, 2026-11-14).
 *
 *   - CREDITS_ENFORCEMENT=all: every agency, current and future, Pro included.
 *   - A request that delivered nothing consumes neither the allowance nor credits
 *     (its provider cost stays recorded).
 *   - The customer-facing WhatsApp agent spends the same balance, one turn = one request.
 *   - Agent previews: rate limited, admitted, released when they deliver nothing.
 *   - The daily USD cap reads the durable ledger; one price table.
 *   - Credit packs sold to every enforced agency; a lost Grow answer is reconciled
 *     by the credits pass alone, credits granted exactly once.
 *
 * Real Postgres, synthetic rows. No provider, no Grow, no WhatsApp call.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'crypto'

vi.mock('@/lib/payments/grow/config', async (orig) => ({ ...(await orig<typeof import('@/lib/payments/grow/config')>()), assertGrowRuntime: () => ({ env: 'staging', mode: 'sandbox' }) }))

import { db } from '@/config/db'
import { admitAgentRequest, settleAgentRequests, operationDelivery } from '@/db/credits/agentRequests'
import { creditPeriodKey, insertEntry, walletBalance } from '@/db/credits/ledger'
import { canPurchaseCredits, canSeeCreditBalance, isCreditEnforcedFor, isGlobalCreditEnforcement, isPackSellable } from '@/lib/credits/config'
import { admitCustomerAgentTurn, releaseCustomerAgentTurn } from '@/lib/credits/customerAgentRequest'
import { PREVIEW_TURNS_PER_HOUR, runPreviewRequest } from '@/lib/credits/previewRequest'
import { runCopilotRequest } from '@/lib/credits/copilotRequest'
import { durableDailySpendUsd } from '@/db/ai/dailySpend'
import { estimateCostUsd } from '@/lib/ai/tasks'
import { MODEL_PRICES } from '@/lib/ai/usage/pricing'
import { purchaseCreditPack } from '@/lib/credits/purchase'
import { reconcileUnknownCharges, type ChargeReconciler } from '@/lib/payments/charges/reconcileUnknown'
import { CREDIT_PACK_CHARGE_KINDS } from '@/db/payments/charges'
import { GrowTransportError } from '@/lib/payments/grow/http'
import type { ExecuteDeps } from '@/lib/payments/charges/executeCharge'
import type { TokenChargeResult } from '@/lib/payments/grow/api'
import { seedOwner } from '../reminders/fixtures'
import { cleanupBilling, hoursFromNow, seedAgency, seedCharge, seedMethod } from '../payments/helpers/billingFixtures'

const CLEAR = [
  'CREDITS_METERING', 'CREDITS_ENFORCEMENT', 'CREDITS_ENFORCEMENT_AGENCY_IDS', 'CREDITS_PURCHASES_AGENCY_IDS', 'CREDITS_UI_AGENCY_IDS',
  'CREDITS_MONTHLY_ALLOWANCE', 'CREDITS_ENFORCE_ON_PRO', 'AI_USAGE_LEDGER', 'CREDITS_PAID_REQUEST_HOLD',
]
const NOW = () => creditPeriodKey(Date.now())
const OLD_MS = () => Date.now() - 30 * 60_000
type Owner = Awaited<ReturnType<typeof seedOwner>>

function launch(over: Record<string, string> = {}) {
  Object.assign(process.env, { CREDITS_METERING: '1', CREDITS_ENFORCEMENT: 'all', AI_USAGE_LEDGER: '1', ...over })
}
async function owner(name: string, plan: 'free' | 'pro' = 'pro'): Promise<Owner> {
  const o = await seedOwner(name)
  await db('agencies').where({ id: o.agencyId }).update({ plan })
  return o
}
const grant = (o: { agencyId: number }, credits: number) =>
  insertEntry(db, { agencyId: o.agencyId, entryType: 'purchase_grant', amountMillis: credits * 1000, periodKey: NOW(), idempotencyKey: `charge:${randomUUID()}`, sourceKind: 'billing_charge', sourceId: '1' })
const ownerReq = (o: Owner, kind: string, id: string, nowMs = OLD_MS()) =>
  admitAgentRequest({ agencyId: o.agencyId, userId: o.userId, source: 'web', operation: { kind, id }, nowMs })
async function usage(o: { agencyId: number; userId?: number | null }, kind: string, id: string, usd: number | null, over: Record<string, unknown> = {}) {
  await db('ai_usage_events').insert({
    callId: randomUUID(), invocationId: randomUUID(), operationKind: kind, operationId: id, agencyId: o.agencyId, userId: o.userId ?? null, feature: 'agent.investigate', provider: 'openai',
    requestedModel: 'gpt-5.6', responseModel: 'gpt-5.6', chainIndex: 0, attempt: 1, stepIndex: 0, status: 'success', usageReported: usd !== null, inputTokens: 1, outputTokens: 1,
    costUsd: usd, costBasis: usd === null ? 'unknown' : 'reported_usage', priceVersion: 'test', currency: 'USD', createdAt: new Date(OLD_MS()), ...over,
  })
}
const rowOf = (agencyId: number, kind: string, id: string) => db('agent_requests').where({ agencyId, operationKind: kind, operationId: id }).first() as Promise<Record<string, any> | undefined>
const debits = (agencyId: number) => db('agency_credit_ledger').where({ agencyId, entryType: 'debit' }).select('amountMillis')
const available = async (agencyId: number) => (await walletBalance(db, agencyId, NOW())).availableMillis

let convSeq = 0
async function conversation(agencyId: number): Promise<number> {
  const n = ++convSeq
  const [c] = await db('inbox_conversations')
    .insert({ agencyId, leadId: null, channel: 'whatsapp', businessPhoneNumberId: `cl_pn_${agencyId}_${n}`, customerWaId: `9725${String(agencyId * 100 + n).padStart(8, '0')}`, customerName: 'לקוח' })
    .returning('id')
  return Number((c as { id: number }).id ?? c)
}
/** One job on its own conversation (one in-flight job per conversation is a database rule). */
async function autoJob(agencyId: number, status: string): Promise<number> {
  const conversationId = await conversation(agencyId)
  const [j] = await db('auto_response_jobs').insert({ agencyId, conversationId, channel: 'whatsapp', reason: 'qualify_turn', triggerSequence: 1, status }).returning('id')
  return Number((j as { id: number }).id ?? j)
}
async function investigation(o: Owner, investigationId: string, status: 'answered' | 'failed') {
  await db('agent_investigations').insert({ agencyId: o.agencyId, userId: o.userId, investigationId, question: 'q', status, stopReason: status === 'failed' ? 'error' : 'answered' })
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  vi.spyOn(console, 'info').mockImplementation(() => undefined)
})
afterEach(async () => {
  for (const k of CLEAR) delete process.env[k]
  vi.restoreAllMocks()
  // Billing fixtures' agencies own ledger rows: clear those first (as purchaseSafety does).
  await db.raw('TRUNCATE agency_credit_ledger')
  await cleanupBilling()
})
afterAll(async () => {
  await db.destroy()
})

describe('CREDITS_ENFORCEMENT=all: every agency, current and future, with no agency list', () => {
  it('enforces a brand-new agency, Pro included, and lets it buy and see its balance', async () => {
    launch()
    const pro = await owner('ga-pro', 'pro')
    const trial = await owner('ga-trial', 'free')
    expect(isGlobalCreditEnforcement()).toBe(true)
    for (const o of [pro, trial]) {
      const plan = o === pro ? 'pro' : 'free'
      expect(isCreditEnforcedFor(o.agencyId, plan)).toBe(true)
      expect(canPurchaseCredits(o.agencyId)).toBe(true)
      expect(isPackSellable(o.agencyId, plan)).toBe(true)
      expect(canSeeCreditBalance(o.agencyId)).toBe(true)
    }
  })

  it('opens only on the exact value `all` (trimmed, any case), and only with metering on', () => {
    launch({ CREDITS_ENFORCEMENT: ' ALL ' })
    expect(isCreditEnforcedFor(987_654, 'pro')).toBe(true)
    process.env.CREDITS_ENFORCEMENT = 'all,103'
    expect(isCreditEnforcedFor(987_654, 'pro')).toBe(false)
    process.env.CREDITS_ENFORCEMENT = 'all'
    delete process.env.CREDITS_METERING
    expect(isCreditEnforcedFor(987_654, 'pro')).toBe(false)
    expect(canPurchaseCredits(987_654)).toBe(false)
    expect(isCreditEnforcedFor(0, 'pro')).toBe(false)
  })

  it('leaves the pilot list path unchanged: a listed Pro agency is not enforced without CREDITS_ENFORCE_ON_PRO', () => {
    process.env.CREDITS_METERING = '1'
    process.env.CREDITS_ENFORCEMENT_AGENCY_IDS = '4242'
    expect(isCreditEnforcedFor(4242, 'pro')).toBe(false)
    expect(isCreditEnforcedFor(4242, 'free')).toBe(true)
    expect(isCreditEnforcedFor(4343, 'free')).toBe(false)
  })

  it('allowance first, then a hard stop, then purchased credits — for a Pro subscriber nobody listed', async () => {
    launch({ CREDITS_MONTHLY_ALLOWANCE: '2' })
    const o = await owner('ga-flow')
    expect(await ownerReq(o, 'copilot_request', 'a')).toEqual({ allowed: true, tier: 'free' })
    expect(await ownerReq(o, 'copilot_request', 'b')).toEqual({ allowed: true, tier: 'free' })
    expect(await ownerReq(o, 'copilot_request', 'c')).toMatchObject({ allowed: false, reason: 'credits_required' })
    await grant(o, 3)
    expect(await ownerReq(o, 'copilot_request', 'd')).toEqual({ allowed: true, tier: 'paid' })
  })
})

describe('a request that delivered nothing consumes nothing (its provider cost stays recorded)', () => {
  it('a failed web investigation is voided at settlement and frees its allowance slot', async () => {
    launch({ CREDITS_MONTHLY_ALLOWANCE: '1' })
    const o = await owner('void-inv')
    const id = `inv_${randomUUID()}`
    await ownerReq(o, 'agent_investigation', id)
    await investigation(o, id, 'failed')
    await usage(o, 'agent_investigation', id, 0.02, { status: 'error' })
    await settleAgentRequests()
    const row = await rowOf(o.agencyId, 'agent_investigation', id)
    expect(row?.tier).toBe('void')
    expect(Number(row?.costMicros)).toBe(20_000) // the provider cost is kept on the row
    expect(await ownerReq(o, 'copilot_request', 'next', Date.now())).toEqual({ allowed: true, tier: 'free' })
  })

  it('an answered investigation still counts', async () => {
    launch()
    const o = await owner('keep-inv')
    const id = `inv_${randomUUID()}`
    await ownerReq(o, 'agent_investigation', id)
    await investigation(o, id, 'answered')
    await usage(o, 'agent_investigation', id, 0.02)
    await settleAgentRequests()
    const row = await rowOf(o.agencyId, 'agent_investigation', id)
    expect(row?.tier).toBe('free')
    expect(row?.settledAt).not.toBeNull()
  })

  it('an undelivered PAID request releases its hold and is never debited', async () => {
    launch({ CREDITS_MONTHLY_ALLOWANCE: '1' })
    const o = await owner('void-paid')
    await ownerReq(o, 'copilot_request', 'spent-free')
    await grant(o, 5)
    const id = `inv_${randomUUID()}`
    expect(await ownerReq(o, 'agent_investigation', id)).toEqual({ allowed: true, tier: 'paid' })
    await investigation(o, id, 'failed')
    await usage(o, 'agent_investigation', id, 0.05, { status: 'error' })
    await settleAgentRequests()
    expect((await rowOf(o.agencyId, 'agent_investigation', id))?.tier).toBe('void')
    expect(await debits(o.agencyId)).toEqual([])
    expect(await available(o.agencyId)).toBe(5000)
  })

  it('auto-reply jobs: skipped and dead are voided, sent counts, a job awaiting a retry stays open', async () => {
    launch()
    const o = await owner('void-auto')
    const ids: Record<string, string> = {}
    for (const status of ['skipped', 'dead', 'sent', 'pending']) {
      ids[status] = String(await autoJob(o.agencyId, status))
      await admitAgentRequest({ agencyId: o.agencyId, userId: null, source: 'whatsapp', operation: { kind: 'auto_response_job', id: ids[status] }, nowMs: OLD_MS() })
      await usage({ agencyId: o.agencyId }, 'auto_response_job', ids[status], 0.01)
    }
    await settleAgentRequests()
    expect((await rowOf(o.agencyId, 'auto_response_job', ids.skipped))?.tier).toBe('void')
    expect((await rowOf(o.agencyId, 'auto_response_job', ids.dead))?.tier).toBe('void')
    const sent = await rowOf(o.agencyId, 'auto_response_job', ids.sent)
    expect(sent?.tier).toBe('free')
    expect(sent?.settledAt).not.toBeNull()
    const pending = await rowOf(o.agencyId, 'auto_response_job', ids.pending)
    expect(pending?.tier).toBe('free')
    expect(pending?.settledAt).toBeNull()
  })

  it('reads only the operation of the SAME agency', async () => {
    const a = await owner('deliv-a')
    const b = await owner('deliv-b')
    const job = String(await autoJob(a.agencyId, 'skipped'))
    expect(await operationDelivery(db, { agencyId: a.agencyId, operationKind: 'auto_response_job', operationId: job })).toBe('undelivered')
    expect(await operationDelivery(db, { agencyId: b.agencyId, operationKind: 'auto_response_job', operationId: job })).toBe('unknown')
    expect(await operationDelivery(db, { agencyId: a.agencyId, operationKind: 'auto_response_job', operationId: 'not-a-number' })).toBe('unknown')
  })

  it('a failed Copilot generation is released at once; a delivered one counts', async () => {
    launch()
    const o = await owner('void-copilot')
    const u = { id: o.userId, agencyId: o.agencyId }
    type R = { ok: boolean; reason?: string }
    await runCopilotRequest<R>(u, () => ({ ok: false }), async () => ({ ok: false, reason: 'ai-unavailable' }))
    await runCopilotRequest<R>(u, () => ({ ok: false }), async () => ({ ok: true }))
    await expect(runCopilotRequest<R>(u, () => ({ ok: false }), async () => { throw new Error('boom') })).rejects.toThrow('boom')
    const rows = await db('agent_requests').where({ agencyId: o.agencyId, operationKind: 'copilot_request' }).orderBy('id').select('tier', 'userId')
    expect(rows.map((r) => r.tier)).toEqual(['void', 'free', 'void'])
    expect(rows.every((r) => r.userId === o.userId)).toBe(true)
  })
})

describe('the customer-facing WhatsApp agent spends the same balance', () => {
  it('one turn is one request on the agency balance, and is refused once the balance is spent', async () => {
    launch({ CREDITS_MONTHLY_ALLOWANCE: '1' })
    const o = await owner('cust-shared')
    const first = await autoJob(o.agencyId, 'processing')
    expect(await admitCustomerAgentTurn({ id: first, agencyId: o.agencyId })).toBe('admitted')
    // The owner's own request now finds the shared allowance used.
    expect(await ownerReq(o, 'copilot_request', 'owner', Date.now())).toMatchObject({ allowed: false })
    const second = await autoJob(o.agencyId, 'processing')
    expect(await admitCustomerAgentTurn({ id: second, agencyId: o.agencyId })).toBe('credits_exhausted')
    await grant(o, 3)
    const third = await autoJob(o.agencyId, 'processing')
    expect(await admitCustomerAgentTurn({ id: third, agencyId: o.agencyId })).toBe('admitted')
    const row = await rowOf(o.agencyId, 'auto_response_job', String(first))
    expect(row).toMatchObject({ source: 'whatsapp', userId: null, tier: 'free' })
  })

  it('a retried job is counted once', async () => {
    launch({ CREDITS_MONTHLY_ALLOWANCE: '5' })
    const o = await owner('cust-retry')
    const job = await autoJob(o.agencyId, 'processing')
    for (let i = 0; i < 3; i++) expect(await admitCustomerAgentTurn({ id: job, agencyId: o.agencyId })).toBe('admitted')
    expect(await db('agent_requests').where({ agencyId: o.agencyId, operationKind: 'auto_response_job' }).count({ n: '*' }).first()).toMatchObject({ n: '1' })
  })

  it('a skipped turn is released at once', async () => {
    launch({ CREDITS_MONTHLY_ALLOWANCE: '1' })
    const o = await owner('cust-release')
    const job = await autoJob(o.agencyId, 'processing')
    await admitCustomerAgentTurn({ id: job, agencyId: o.agencyId })
    await releaseCustomerAgentTurn({ id: job, agencyId: o.agencyId })
    expect((await rowOf(o.agencyId, 'auto_response_job', String(job)))?.tier).toBe('void')
    const next = await autoJob(o.agencyId, 'processing')
    expect(await admitCustomerAgentTurn({ id: next, agencyId: o.agencyId })).toBe('admitted')
  })

  it('is not metered at all when credits are off', async () => {
    const o = await owner('cust-off')
    const job = await autoJob(o.agencyId, 'processing')
    expect(await admitCustomerAgentTurn({ id: job, agencyId: o.agencyId })).toBe('admitted')
    expect(await rowOf(o.agencyId, 'auto_response_job', String(job))).toBeUndefined()
  })
})

describe('agent previews: rate limited, admitted, released', () => {
  it(`allows ${PREVIEW_TURNS_PER_HOUR} turns per user per hour, then refuses`, async () => {
    launch({ CREDITS_MONTHLY_ALLOWANCE: '500' })
    const o = await owner('preview-rate')
    const u = { id: o.userId, agencyId: o.agencyId }
    for (let i = 0; i < PREVIEW_TURNS_PER_HOUR; i++) expect(await runPreviewRequest(u, (why) => ({ ok: false, reason: why }), async () => ({ ok: true }))).toEqual({ ok: true })
    const run = vi.fn(async () => ({ ok: true }))
    expect(await runPreviewRequest(u, (why) => ({ ok: false, reason: why }), run)).toEqual({ ok: false, reason: 'rate_limited' })
    expect(run).not.toHaveBeenCalled()
  })

  it('is refused without allowance or credits, and a preview that delivered nothing is released', async () => {
    launch({ CREDITS_MONTHLY_ALLOWANCE: '1' })
    const o = await owner('preview-credits')
    const u = { id: o.userId, agencyId: o.agencyId }
    expect(await runPreviewRequest(u, (why) => ({ ok: false, reason: why }), async () => ({ ok: false, reason: 'no_description' }))).toEqual({ ok: false, reason: 'no_description' })
    expect(await runPreviewRequest(u, (why) => ({ ok: false, reason: why }), async () => ({ ok: true }))).toEqual({ ok: true })
    expect(await runPreviewRequest(u, (why) => ({ ok: false, reason: why }), async () => ({ ok: true }))).toEqual({ ok: false, reason: 'credits_exhausted' })
    const tiers = (await db('agent_requests').where({ agencyId: o.agencyId, operationKind: 'auto_response_preview' }).orderBy('id').select('tier')).map((r) => r.tier)
    expect(tiers).toEqual(['void', 'free', 'blocked'])
  })
})

describe('the daily USD cap reads the durable ledger', () => {
  it("sums today's (UTC) cost for this agency only, and has no figure with the ledger off", async () => {
    const a = await owner('spend-a')
    const b = await owner('spend-b')
    const today = new Date()
    const yesterday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) - 60_000)
    await usage(a, 'copilot_request', 't1', 1.25, { createdAt: today })
    await usage(a, 'copilot_request', 't2', 0.75, { createdAt: today })
    await usage(a, 'copilot_request', 'y', 9, { createdAt: yesterday })
    await usage(b, 'copilot_request', 'other', 4, { createdAt: today })
    await usage(a, 'copilot_request', 'unknown', null, { createdAt: today })
    expect(await durableDailySpendUsd(a.agencyId, today)).toBeNull()
    process.env.AI_USAGE_LEDGER = '1'
    expect(await durableDailySpendUsd(a.agencyId, today)).toBeCloseTo(2, 6)
  })
})

describe('one price table', () => {
  it('the spend estimate prices gpt-5.6 from the ledger table (uncached input, output)', () => {
    const sol = MODEL_PRICES['gpt-5.6-sol']
    expect(estimateCostUsd('gpt-5.6', 1_000_000, 1_000_000)).toBeCloseTo(sol.input + sol.output, 6)
    expect(estimateCostUsd('claude-sonnet-4-6', 2_000_000, 0)).toBeCloseTo(MODEL_PRICES['claude-sonnet-4-6'].input * 2, 6)
  })
  it('an unlisted model is priced conservatively, never at zero', () => {
    expect(estimateCostUsd('some-new-model', 1_000_000, 1_000_000)).toBeCloseTo(20, 6)
  })
})

describe('credit packs for every enforced agency', () => {
  const paid = (tx: string): TokenChargeResult => ({ kind: 'paid', transactionId: tx, transactionToken: 'tt', asmachta: '1', statusCode: '2' })
  const grow = (result: TokenChargeResult | Error): ExecuteDeps => ({
    chargeToken: vi.fn(async (): Promise<TokenChargeResult> => {
      if (result instanceof Error) throw result
      return result
    }),
    dispatchAllowed: () => true,
  })
  async function subscriber() {
    const agencyId = await seedAgency({ plan: 'pro', planReason: 'grow:seed-tx', trialStartedAt: hoursFromNow(-800), trialEndsAt: hoursFromNow(-600) })
    const pm = await seedMethod(agencyId)
    return { agencyId, pm }
  }
  const grants = (agencyId: number) => db('agency_credit_ledger').where({ agencyId, entryType: 'purchase_grant' }).select('amountMillis')

  it('a Pro subscriber buys a pack with no agency list; Grow-confirmed payment adds the credits once', async () => {
    launch()
    const { agencyId } = await subscriber()
    const key = randomUUID()
    expect(await purchaseCreditPack({ agencyId, kind: 'credits_200', requestKey: key }, grow(paid(`tx-ga-${agencyId}`)))).toEqual({ state: 'granted' })
    expect(await purchaseCreditPack({ agencyId, kind: 'credits_200', requestKey: key }, grow(paid(`tx-ga-${agencyId}`)))).toEqual({ state: 'already_granted' })
    expect(await grants(agencyId)).toEqual([{ amountMillis: '200000' }])
  })

  it('a lost Grow answer is reconciled by the credits pass alone: packs only, credits granted exactly once', async () => {
    launch()
    const { agencyId, pm } = await subscriber()
    await purchaseCreditPack({ agencyId, kind: 'credits_500', requestKey: randomUUID() }, grow(new GrowTransportError('timeout')))
    const subscriptionUnknown = await seedCharge(agencyId, pm, { kind: 'renewal', periodKey: '2026-11', status: 'unknown', dispatchedAt: new Date() })
    const seen: string[] = []
    const reconciler: ChargeReconciler = async (charge) => {
      seen.push(charge.kind)
      return { kind: 'paid', paid: { transactionId: `tx-recon-${agencyId}`, transactionToken: null, asmachta: '1', statusCode: '2' } }
    }
    expect(await reconcileUnknownCharges(20, reconciler, { kinds: CREDIT_PACK_CHARGE_KINDS })).toMatchObject({ paid: 1 })
    expect(seen).toEqual(['credits_500'])
    expect(await grants(agencyId)).toEqual([{ amountMillis: '500000' }])
    // A second pass finds nothing left to reconcile: no second grant.
    expect(await reconcileUnknownCharges(20, reconciler, { kinds: CREDIT_PACK_CHARGE_KINDS })).toMatchObject({ paid: 0 })
    expect(await grants(agencyId)).toEqual([{ amountMillis: '500000' }])
    // The subscription charge was not touched by the credits pass.
    expect((await db('billing_charges').where({ id: subscriptionUnknown }).first('status'))?.status).toBe('unknown')
  })
})
