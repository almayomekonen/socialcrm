/**
 * The AI reply draft under the same allowance and credits as the Agent. Real
 * Postgres and the real action; only the model and the lead reads are mocked.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'crypto'

const H = vi.hoisted(() => ({
  user: { id: 0, agencyId: 0, role: 'ADMIN' },
  snapshot: { inputs: {} } as { inputs: Record<string, unknown> } | null,
  runStructured: vi.fn(),
}))
vi.mock('@/lib/requireUser', () => ({ requireProductAccess: async () => H.user }))
vi.mock('@/lib/ai/router', () => ({ runStructured: H.runStructured }))
vi.mock('@/db/aiSummaries', () => ({ getLeadIntelligenceInputs: async () => H.snapshot }))
vi.mock('@/db/clients', () => ({ getFullLead: async () => ({ name: 'דנה' }) }))
vi.mock('@/db/inboxMessages', () => ({ listLeadWhatsappMessages: async () => [] }))
vi.mock('@/lib/ai/prompts/whatsappReplyDraft', () => ({ buildWhatsappReplyUserMessage: () => 'prompt' }))
vi.mock('@/lib/ai/prompts/leadFollowup', () => ({
  LEAD_FOLLOWUP_SYSTEM_PROMPT: 'system',
  LeadFollowupSchema: {},
  sanitizeLeadFollowup: (d: { message: string }) => ({ result: d.message === 'polluted' ? null : d, report: {} }),
}))

import { db } from '@/config/db'
import { generateWhatsappReplyDraft } from '@/actions/ai/whatsappReplyDraft'
import { admitAgentRequest, settleAgentRequests } from '@/db/credits/agentRequests'
import { creditPeriodKey, insertEntry, walletBalance } from '@/db/credits/ledger'
import { currentAiOperation } from '@/lib/ai/usage/context'
import { aiUsageCategory } from '@/lib/credits/aiCategories'
import { REPLY_DRAFT_OPERATION_KIND } from '@/lib/credits/replyDraftRequest'
import { seedOwner } from '../reminders/fixtures'
import { seedUser } from '../mcp/fixtures'

type Owner = Awaited<ReturnType<typeof seedOwner>>
const CLEAR = ['CREDITS_METERING', 'CREDITS_ENFORCEMENT_AGENCY_IDS', 'CREDITS_MONTHLY_ALLOWANCE', 'CREDITS_ENFORCE_ON_PRO', 'AI_USAGE_LEDGER']
const LEAD = 77
const LATER = () => Date.now() + 60 * 60_000
const drafted = { ok: true, data: { message: 'שלום דנה' } }

const period = () => creditPeriodKey(Date.now())
const rows = (o: Owner) => db('agent_requests').where({ agencyId: o.agencyId }).orderBy('id').select('*') as Promise<Record<string, any>[]>
const counted = async (o: Owner) => (await rows(o)).filter((r) => r.tier !== 'void')
const grant = (o: Owner, credits: number) =>
  insertEntry(db, { agencyId: o.agencyId, entryType: 'purchase_grant', amountMillis: credits * 1000, periodKey: period(), idempotencyKey: `charge:${randomUUID()}`, sourceKind: 'billing_charge', sourceId: randomUUID() } as never)
const available = async (o: Owner) => (await walletBalance(db, o.agencyId, period())).availableMillis
const draft = (requestId: unknown = randomUUID()) => generateWhatsappReplyDraft(LEAD, requestId as string)

async function cost(o: Owner, op: string, usd: number) {
  await db('ai_usage_events').insert({
    callId: randomUUID(), invocationId: randomUUID(), operationKind: REPLY_DRAFT_OPERATION_KIND, operationId: op, agencyId: o.agencyId, userId: o.userId, feature: 'agent.investigate', provider: 'openai', requestedModel: 'm', responseModel: 'm', chainIndex: 0, attempt: 1, stepIndex: 0, status: 'success',
    usageReported: usd !== null, inputTokens: 1, outputTokens: 1, costUsd: usd, costBasis: usd === null ? 'unknown' : 'reported_usage', priceVersion: 'test', currency: 'USD', createdAt: new Date(),
  })
}

async function owner(name: string, enforce = true): Promise<Owner> {
  const o = await seedOwner(name)
  await db('agencies').where({ id: o.agencyId }).update({ plan: 'free' })
  if (enforce) process.env.CREDITS_ENFORCEMENT_AGENCY_IDS = String(o.agencyId)
  H.user.id = o.userId
  H.user.agencyId = o.agencyId
  return o
}
/** Use up the allowance of `n` through the Agent, the same counter a draft draws on. */
async function spend(o: Owner, n: number) {
  process.env.CREDITS_MONTHLY_ALLOWANCE = String(n)
  for (let i = 0; i < n; i++) await admitAgentRequest({ agencyId: o.agencyId, userId: o.userId, source: 'web', operation: { kind: 'agent_investigation', id: randomUUID() }, nowMs: Date.now() })
}

beforeEach(() => {
  process.env.CREDITS_METERING = '1'
  H.snapshot = { inputs: {} }
  H.runStructured.mockReset()
  H.runStructured.mockResolvedValue(drafted)
  for (const m of ['error', 'warn', 'info'] as const) vi.spyOn(console, m).mockImplementation(() => undefined)
})
afterEach(async () => {
  for (const k of CLEAR) delete process.env[k]
  vi.restoreAllMocks()
  await db.raw('TRUNCATE platform_entitlements') // row triggers do not fire on TRUNCATE (test cleanup only)
})
afterAll(async () => {
  await db.destroy()
})

describe('counting', () => {
  it('one draft is one request, classified as owner-initiated, whether or not it is sent', async () => {
    const o = await owner('__rd_one__')
    expect(await draft()).toEqual({ ok: true, message: 'שלום דנה' })
    const all = await rows(o)
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({ operationKind: REPLY_DRAFT_OPERATION_KIND, tier: 'free', source: 'web' })
    expect(aiUsageCategory(REPLY_DRAFT_OPERATION_KIND)).toBe('agent')
    expect(H.runStructured).toHaveBeenCalledTimes(1)
  })

  it('each press after a delivered draft is another request', async () => {
    const o = await owner('__rd_regen__')
    await draft()
    await draft()
    expect(await counted(o)).toHaveLength(2)
    expect(H.runStructured).toHaveBeenCalledTimes(2)
  })

  it('draws on the same 50 as the Agent', async () => {
    const o = await owner('__rd_shared__')
    await spend(o, 2)
    expect(await draft()).toEqual({ ok: false, reason: 'ai-credits-exhausted' })
    expect((await rows(o)).filter((r) => r.tier === 'free')).toHaveLength(2)
  })

  it('internal model calls belong to the one request and settle once', async () => {
    const o = await owner('__rd_internal__')
    await spend(o, 1)
    await grant(o, 10)
    process.env.AI_USAGE_LEDGER = '1'
    H.runStructured.mockImplementation(async () => {
      const op = currentAiOperation()!
      await cost(o, op.id as string, 0.03)
      await cost(o, op.id as string, 0.03)
      return drafted
    })
    const before = await available(o)
    await draft()
    await settleAgentRequests({ nowMs: LATER() })
    const row = (await rows(o)).find((r) => r.operationKind === REPLY_DRAFT_OPERATION_KIND)!
    expect(row).toMatchObject({ tier: 'paid', calls: 2 })
    expect(before - (await available(o))).toBe(Number(row.debitMillis))
    expect(await db('agency_credit_ledger').where({ agencyId: o.agencyId, entryType: 'debit' })).toHaveLength(1)
  })
})

describe('retries and idempotency', () => {
  it('replaying a delivered press runs no model and counts nothing more', async () => {
    const o = await owner('__rd_replay__')
    const id = randomUUID()
    await draft(id)
    expect(await draft(id)).toEqual({ ok: false, reason: 'duplicate-request' })
    expect(await rows(o)).toHaveLength(1)
    expect(H.runStructured).toHaveBeenCalledTimes(1)
  })

  it('the same press sent twice at once runs one model call', async () => {
    const o = await owner('__rd_race__')
    const id = randomUUID()
    const out = await Promise.all([draft(id), draft(id)])
    expect(out.filter((r) => r.ok === true)).toHaveLength(1)
    expect(await rows(o)).toHaveLength(1)
    expect(H.runStructured).toHaveBeenCalledTimes(1)
  })

  it('a provider failure stops counting, so trying again is one request in total', async () => {
    const o = await owner('__rd_fail__')
    H.runStructured.mockResolvedValueOnce({ ok: false, reason: 'ai-failed' })
    expect(await draft()).toEqual({ ok: false, reason: 'ai-failed' })
    expect(await counted(o)).toHaveLength(0)
    expect(await draft()).toEqual({ ok: true, message: 'שלום דנה' })
    expect(await counted(o)).toHaveLength(1)
  })

  it('unusable model output and a thrown error do not count either', async () => {
    const o = await owner('__rd_bad__')
    H.runStructured.mockResolvedValueOnce({ ok: true, data: { message: 'polluted' } })
    expect(await draft()).toEqual({ ok: false, reason: 'invalid-output' })
    H.runStructured.mockRejectedValueOnce(new Error('boom'))
    await expect(draft()).rejects.toThrow('boom')
    expect(await counted(o)).toHaveLength(0)
  })

  it('a voided press cannot be replayed for a free draft', async () => {
    const o = await owner('__rd_void_replay__')
    const id = randomUUID()
    H.runStructured.mockResolvedValueOnce({ ok: false, reason: 'ai-failed' })
    await draft(id)
    expect(await draft(id)).toEqual({ ok: false, reason: 'duplicate-request' })
    expect(H.runStructured).toHaveBeenCalledTimes(1)
    expect(await rows(o)).toHaveLength(1)
  })

  it('a missing or malformed id still counts, each time', async () => {
    const o = await owner('__rd_badid__')
    await draft('not-a-uuid')
    await draft('not-a-uuid')
    await draft(undefined)
    expect(await counted(o)).toHaveLength(3)
  })

  it('the id is scoped to the user: one user cannot use up another\'s', async () => {
    const a = await owner('__rd_user_a__')
    const id = randomUUID()
    await draft(id)
    H.user.id = await seedUser(a.agencyId, 'ADMIN', 'Second')
    expect((await draft(id)).ok).toBe(true)
    expect(await counted(a)).toHaveLength(2)
  })
})

describe('allowance and credits', () => {
  it('past the allowance with no credits: no model, the limit reason, one blocked row', async () => {
    const o = await owner('__rd_block__')
    await spend(o, 1)
    expect(await draft()).toEqual({ ok: false, reason: 'ai-credits-exhausted' })
    expect(H.runStructured).not.toHaveBeenCalled()
    expect((await rows(o)).filter((r) => r.tier === 'blocked')).toHaveLength(1)
  })

  it('past the allowance with credits: paid, and a failure releases the hold', async () => {
    const o = await owner('__rd_paid__')
    await spend(o, 1)
    await grant(o, 10)
    expect((await draft()).ok).toBe(true)
    const paid = (await rows(o)).find((r) => r.operationKind === REPLY_DRAFT_OPERATION_KIND)!
    expect(paid.tier).toBe('paid')
    expect(Number(paid.holdMillis)).toBeGreaterThan(0)

    H.runStructured.mockResolvedValueOnce({ ok: false, reason: 'ai-failed' })
    await draft()
    const failed = (await rows(o)).filter((r) => r.operationKind === REPLY_DRAFT_OPERATION_KIND)[1]
    expect(failed.tier).toBe('void')
    expect(failed.settledAt).not.toBeNull()
  })

  it('a failed admission on an enforced agency runs no model', async () => {
    await owner('__rd_unavail__')
    vi.spyOn(db, 'transaction').mockRejectedValueOnce(new Error('db down') as never)
    expect(await draft()).toEqual({ ok: false, reason: 'ai-unavailable' })
    expect(H.runStructured).not.toHaveBeenCalled()
  })

  it('not enforced: past the allowance it runs, recorded as unmetered', async () => {
    const o = await owner('__rd_unenforced__', false)
    await spend(o, 1)
    expect((await draft()).ok).toBe(true)
    expect((await rows(o)).find((r) => r.operationKind === REPLY_DRAFT_OPERATION_KIND)!.tier).toBe('unmetered')
  })

  it('metering off: the draft works and nothing is recorded', async () => {
    delete process.env.CREDITS_METERING
    const o = await owner('__rd_off__', false)
    expect((await draft()).ok).toBe(true)
    expect(await rows(o)).toHaveLength(0)
  })
})

describe('the founder and tenant boundaries', () => {
  it('a founder is exempt: not counted against the allowance, and never refused', async () => {
    const o = await owner('__rd_founder__')
    await spend(o, 1)
    await db('platform_entitlements').insert({ agencyId: o.agencyId, userId: o.userId, entitlement: 'founder_unlimited_usage', reason: 'test founder', grantedBy: 'test' })
    expect((await draft()).ok).toBe(true)
    const row = (await rows(o)).find((r) => r.operationKind === REPLY_DRAFT_OPERATION_KIND)!
    expect(row.tier).toBe('exempt')
  })

  it('a failed founder draft stays exempt rather than being voided', async () => {
    const o = await owner('__rd_founder_fail__')
    await db('platform_entitlements').insert({ agencyId: o.agencyId, userId: o.userId, entitlement: 'founder_unlimited_usage', reason: 'test founder', grantedBy: 'test' })
    H.runStructured.mockResolvedValueOnce({ ok: false, reason: 'ai-failed' })
    await draft()
    expect((await rows(o))[0].tier).toBe('exempt')
  })

  it('a lead the user cannot read counts nothing and runs no model', async () => {
    const o = await owner('__rd_other_lead__')
    H.snapshot = null
    expect(await draft()).toEqual({ ok: false, reason: 'invalid-input' })
    expect(await rows(o)).toHaveLength(0)
    expect(H.runStructured).not.toHaveBeenCalled()
  })

  it('one agency\'s drafts do not touch another\'s allowance', async () => {
    const a = await owner('__rd_tenant_a__', false)
    await draft()
    const b = await owner('__rd_tenant_b__', false)
    expect(await rows(b)).toHaveLength(0)
    expect(await rows(a)).toHaveLength(1)
  })
})
