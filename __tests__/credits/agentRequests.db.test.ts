/**
 * The 50-request allowance: durable, atomic, idempotent, then purchased credits
 * with holds. Real Postgres, synthetic rows, no provider call.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'crypto'
import { db } from '@/config/db'
import { admitAgentRequest, settleAgentRequests, spendableMillis } from '@/db/credits/agentRequests'
import { creditPeriodKey, insertEntry, walletBalance } from '@/db/credits/ledger'
import { seedOwner } from '../reminders/fixtures'

const CLEAR = ['CREDITS_METERING', 'CREDITS_ENFORCEMENT_AGENCY_IDS', 'CREDITS_MONTHLY_ALLOWANCE', 'CREDITS_ENFORCE_ON_PRO', 'AI_USAGE_LEDGER', 'CREDITS_PAID_REQUEST_HOLD']
const NOW = () => creditPeriodKey(Date.now())
const OLD_MS = () => Date.now() - 30 * 60_000
type Owner = Awaited<ReturnType<typeof seedOwner>>

async function owner(name: string, enforce = true): Promise<Owner> {
  const o = await seedOwner(name)
  await db('agencies').where({ id: o.agencyId }).update({ plan: 'free' })
  if (enforce) process.env.CREDITS_ENFORCEMENT_AGENCY_IDS = [process.env.CREDITS_ENFORCEMENT_AGENCY_IDS, o.agencyId].filter(Boolean).join(',')
  return o
}
const req = (o: Owner, id: string, over: { nowMs?: number; userId?: number | null } = {}) =>
  admitAgentRequest({ agencyId: o.agencyId, userId: over.userId === undefined ? o.userId : over.userId, source: 'whatsapp', operation: { kind: 'wa_assistant_job', id }, nowMs: over.nowMs ?? OLD_MS() })
const grant = (o: Owner, credits: number) => insertEntry(db, { agencyId: o.agencyId, entryType: 'purchase_grant', amountMillis: credits * 1000, periodKey: NOW(), idempotencyKey: `charge:${randomUUID()}`, sourceKind: 'billing_charge', sourceId: '1' })
async function cost(o: Owner, op: string, usd: number | null, over: Record<string, unknown> = {}) {
  await db('ai_usage_events').insert({
    callId: randomUUID(), invocationId: randomUUID(), operationKind: 'wa_assistant_job', operationId: op, agencyId: o.agencyId, userId: o.userId, feature: 'agent.investigate', provider: 'openai', requestedModel: 'm', responseModel: 'm', chainIndex: 0, attempt: 1, stepIndex: 0, status: 'success',
    usageReported: usd !== null, inputTokens: 1, outputTokens: 1, costUsd: usd, costBasis: usd === null ? 'unknown' : 'reported_usage', priceVersion: 'test', currency: 'USD', createdAt: new Date(OLD_MS()), ...over,
  })
}
const requests = (o: Owner) => db('agent_requests').where({ agencyId: o.agencyId }).orderBy('id').select('*') as Promise<Record<string, any>[]>
const ledger = (o: Owner) => db('agency_credit_ledger').where({ agencyId: o.agencyId }).whereNot('entryType', 'purchase_grant').select('entryType', 'amountMillis', 'idempotencyKey', 'costMicros', 'meta') as Promise<Record<string, any>[]>
const available = async (o: Owner) => (await walletBalance(db, o.agencyId, NOW())).availableMillis
const tiers = (r: Awaited<ReturnType<typeof req>>[]) => r.map((x) => ('tier' in x ? x.tier : 'blocked')).sort()

beforeEach(() => {
  process.env.CREDITS_METERING = '1'
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  vi.spyOn(console, 'info').mockImplementation(() => undefined)
})
afterEach(() => {
  for (const k of CLEAR) delete process.env[k]
  vi.restoreAllMocks()
})
afterAll(async () => {
  await db.destroy()
})

describe('the free monthly allowance', () => {
  it('requests 1 to 50 run without purchased credits; request 51 is blocked on an empty wallet', async () => {
    const o = await owner('r-50')
    for (let i = 1; i <= 50; i++) expect(await req(o, `op${i}`)).toEqual({ allowed: true, tier: 'free' })
    expect(await req(o, 'op51')).toMatchObject({ allowed: false, reason: 'credits_required' })
    expect(await available(o)).toBe(0)
  })

  it('request 51 runs when purchased credits cover it, and blocks when they do not', async () => {
    process.env.CREDITS_MONTHLY_ALLOWANCE = '1'
    const o = await owner('r-51')
    await req(o, 'a')
    await grant(o, 2)
    expect(await req(o, 'b')).toMatchObject({ allowed: false })
    await grant(o, 1)
    expect(await req(o, 'c')).toEqual({ allowed: true, tier: 'paid' })
  })

  it('resets at the Asia/Jerusalem month boundary, not at UTC midnight', async () => {
    process.env.CREDITS_MONTHLY_ALLOWANCE = '1'
    const o = await owner('r-reset')
    expect(await req(o, 'nov', { nowMs: Date.UTC(2026, 10, 30, 21, 0) })).toEqual({ allowed: true, tier: 'free' }) // 23:00 Nov 30 in Israel
    expect(await req(o, 'nov2', { nowMs: Date.UTC(2026, 10, 30, 21, 30) })).toMatchObject({ allowed: false })
    expect(await req(o, 'dec', { nowMs: Date.UTC(2026, 10, 30, 22, 30) })).toEqual({ allowed: true, tier: 'free' }) // 00:30 Dec 1 in Israel
  })

  it('a retried or duplicate request counts once and gets the same decision', async () => {
    process.env.CREDITS_MONTHLY_ALLOWANCE = '1'
    const o = await owner('r-dup')
    await req(o, 'same')
    await req(o, 'same')
    expect(await req(o, 'same')).toEqual({ allowed: true, tier: 'free' })
    expect(await req(o, 'next')).toMatchObject({ allowed: false })
    expect(await requests(o)).toHaveLength(2)
  })

  it('many internal AI calls of one request are one request', async () => {
    process.env.AI_USAGE_LEDGER = '1'
    process.env.CREDITS_MONTHLY_ALLOWANCE = '2'
    const o = await owner('r-internal')
    await req(o, 'one')
    for (let i = 0; i < 5; i++) await cost(o, 'one', 0.01, { stepIndex: i })
    await settleAgentRequests()
    expect(await requests(o)).toEqual([expect.objectContaining({ tier: 'free', calls: 5, costMicros: '50000' })])
    expect(await req(o, 'two')).toEqual({ allowed: true, tier: 'free' })
  })

  it('concurrent requests cannot exceed the allowance', async () => {
    process.env.CREDITS_MONTHLY_ALLOWANCE = '3'
    const o = await owner('r-race')
    const r = await Promise.all(Array.from({ length: 12 }, (_, i) => req(o, `c${i}`)))
    expect(tiers(r)).toEqual([...Array(9).fill('blocked'), 'free', 'free', 'free'])
  })

  it('agencies are isolated', async () => {
    process.env.CREDITS_MONTHLY_ALLOWANCE = '1'
    const a = await owner('r-iso-a')
    const b = await owner('r-iso-b')
    await grant(a, 10)
    await req(a, 'x')
    await req(a, 'y')
    expect(await req(b, 'x')).toEqual({ allowed: true, tier: 'free' })
    expect(await req(b, 'y')).toMatchObject({ allowed: false })
    expect(await available(b)).toBe(0)
  })
})

describe('paid requests', () => {
  it('holds stop concurrent requests from spending the same credits', async () => {
    process.env.CREDITS_MONTHLY_ALLOWANCE = '1'
    const o = await owner('r-holds')
    await grant(o, 7)
    await req(o, 'free')
    const r = await Promise.all(Array.from({ length: 5 }, (_, i) => req(o, `p${i}`)))
    expect(tiers(r)).toEqual(['blocked', 'blocked', 'blocked', 'paid', 'paid'])
    expect(await spendableMillis(db, o.agencyId, NOW())).toBe(1000)
  })

  it('debits actual cost once and releases the hold', async () => {
    process.env.AI_USAGE_LEDGER = '1'
    process.env.CREDITS_MONTHLY_ALLOWANCE = '1'
    const o = await owner('r-debit')
    await grant(o, 10)
    await req(o, 'free')
    await req(o, 'paid1')
    await cost(o, 'paid1', 0.01)
    await cost(o, 'paid1', 0.02, { provider: 'anthropic', chainIndex: 1 })
    await settleAgentRequests()
    await settleAgentRequests()
    const l = await ledger(o)
    expect(l.filter((e) => e.amountMillis !== '0')).toEqual([expect.objectContaining({ entryType: 'debit', amountMillis: '-1000', costMicros: '30000' })])
    expect(await available(o)).toBe(9000)
    expect(await spendableMillis(db, o.agencyId, NOW())).toBe(9000)
  })

  it('never goes negative: a costly request is capped at its hold and the overage is recorded', async () => {
    process.env.AI_USAGE_LEDGER = '1'
    process.env.CREDITS_MONTHLY_ALLOWANCE = '1'
    const o = await owner('r-cap')
    await grant(o, 3)
    await req(o, 'free')
    await req(o, 'big')
    await cost(o, 'big', 5)
    await settleAgentRequests()
    expect(await available(o)).toBe(0)
    const debit = (await ledger(o)).find((e) => e.entryType === 'debit')!
    expect(debit.amountMillis).toBe('-3000')
    expect(debit.meta.absorbedMillis).toBeGreaterThan(0)
  })

  it('a request that made no AI call is void: it does not count and its hold is released', async () => {
    process.env.AI_USAGE_LEDGER = '1'
    process.env.CREDITS_MONTHLY_ALLOWANCE = '1'
    const o = await owner('r-void')
    await req(o, 'crashed')
    await db('agent_requests').where({ agencyId: o.agencyId }).update({ createdAt: new Date(OLD_MS()) })
    await settleAgentRequests()
    expect((await requests(o))[0].tier).toBe('void')
    expect(await req(o, 'after')).toEqual({ allowed: true, tier: 'free' })
  })

  it('a paid request with no reported cost debits nothing and is flagged', async () => {
    process.env.AI_USAGE_LEDGER = '1'
    process.env.CREDITS_MONTHLY_ALLOWANCE = '1'
    const o = await owner('r-unpriced')
    await grant(o, 5)
    await req(o, 'free')
    await req(o, 'u')
    await cost(o, 'u', null)
    expect((await settleAgentRequests()).unpriced).toBeGreaterThanOrEqual(1)
    expect((await ledger(o)).find((e) => e.entryType === 'debit')).toMatchObject({ amountMillis: '0' })
  })

  it('an in-flight operation is not settled until it is quiet', async () => {
    process.env.AI_USAGE_LEDGER = '1'
    process.env.CREDITS_MONTHLY_ALLOWANCE = '1'
    const o = await owner('r-quiet')
    await grant(o, 5)
    await req(o, 'free')
    await req(o, 'running')
    await cost(o, 'running', 0.03, { createdAt: new Date() })
    await settleAgentRequests()
    expect((await requests(o))[1].settledAt).toBeNull()
  })
})

describe('the founder', () => {
  const founder = (o: Owner) => db('platform_entitlements').insert({ agencyId: o.agencyId, userId: o.userId, entitlement: 'founder_unlimited_usage', reason: 'test', grantedBy: 'test' })
  it('is exempt and never counts; another user of the same agency is counted', async () => {
    process.env.CREDITS_MONTHLY_ALLOWANCE = '1'
    const o = await owner('r-founder')
    await founder(o)
    for (let i = 0; i < 4; i++) expect(await req(o, `f${i}`)).toEqual({ allowed: true, tier: 'exempt' })
    const [u] = await db('users').insert({ firstName: 'Other', lastName: 'User', role: 'AGNT', agencyId: o.agencyId }).returning('id')
    expect(await req(o, 'o1', { userId: Number(u.id) })).toEqual({ allowed: true, tier: 'free' })
    expect(await req(o, 'o2', { userId: Number(u.id) })).toMatchObject({ allowed: false })
    expect(await req(o, 'none', { userId: null })).toMatchObject({ allowed: false })
  })
  it('records real cost at zero amount', async () => {
    process.env.AI_USAGE_LEDGER = '1'
    const o = await owner('r-founder-cost')
    await founder(o)
    await req(o, 'mine')
    await cost(o, 'mine', 0.05)
    await settleAgentRequests()
    expect(await ledger(o)).toEqual([expect.objectContaining({ entryType: 'exempt_debit', amountMillis: '0', costMicros: '50000' })])
  })
})

describe('the WhatsApp notice decision', () => {
  it('full once per month, then a short one rate-limited per user, and a retry repeats its own decision', async () => {
    process.env.CREDITS_MONTHLY_ALLOWANCE = '1'
    const o = await owner('r-notice')
    const t0 = Date.now() - 5 * 3_600_000
    await req(o, 'free', { nowMs: t0 })
    expect(await req(o, 'b1', { nowMs: t0 })).toMatchObject({ notice: 'full' })
    expect(await req(o, 'b1', { nowMs: t0 })).toMatchObject({ notice: 'full' })
    expect(await req(o, 'b2', { nowMs: t0 + 60_000 })).toMatchObject({ notice: null })
    expect(await req(o, 'b3', { nowMs: t0 + 2 * 3_600_000 })).toMatchObject({ notice: 'short' })
    expect(await req(o, 'b4', { nowMs: t0 + 2 * 3_600_000 + 60_000 })).toMatchObject({ notice: null })
    expect((await requests(o)).filter((r) => r.notice === 'full')).toHaveLength(1)
  })
})

describe('where nothing is enforced', () => {
  it('a Pro agency, even when listed, is never refused; the policy switch is required', async () => {
    process.env.CREDITS_MONTHLY_ALLOWANCE = '1'
    const o = await owner('r-pro')
    await db('agencies').where({ id: o.agencyId }).update({ plan: 'pro' })
    await req(o, 'a')
    expect(await req(o, 'b')).toEqual({ allowed: true, tier: 'unmetered' })
    process.env.CREDITS_ENFORCE_ON_PRO = '1'
    expect(await req(o, 'c')).toMatchObject({ allowed: false })
  })

  it('an unlisted agency is recorded and never refused', async () => {
    process.env.CREDITS_MONTHLY_ALLOWANCE = '1'
    const o = await owner('r-shadow', false)
    await req(o, 'a')
    expect(await req(o, 'b')).toEqual({ allowed: true, tier: 'unmetered' })
    expect(await ledger(o)).toEqual([])
  })

  it('metering off writes nothing', async () => {
    delete process.env.CREDITS_METERING
    const o = await owner('r-off')
    expect(await req(o, 'a')).toEqual({ allowed: true, tier: 'unmetered' })
    expect(await requests(o)).toEqual([])
  })

  it('if the decision cannot be made, an enforced agency does not run paid work; an unenforced one is unaffected', async () => {
    const o = await owner('r-fault')
    const spy = vi.spyOn(db, 'transaction').mockRejectedValueOnce(new Error('down'))
    expect(await req(o, 'x')).toEqual({ allowed: false, reason: 'unavailable', notice: null })
    spy.mockRejectedValueOnce(new Error('down'))
    delete process.env.CREDITS_ENFORCEMENT_AGENCY_IDS
    expect(await req(o, 'y')).toEqual({ allowed: true, tier: 'unmetered' })
  })
})
