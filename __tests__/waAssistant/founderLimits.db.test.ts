import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Founder entitlement (`founder_unlimited_usage`): the commercial limits are
 * waived for ONE verified user of ONE agency, technical abuse protection and
 * every security/emergency control stay. Real database, real worker and
 * webhook; the model and Meta are mocked; all agencies and numbers synthetic.
 */
const flags = vi.hoisted(() => ({ agent: true }))
vi.mock('@/lib/ai/flags', async (orig) => ({ ...(await orig<typeof import('@/lib/ai/flags')>()), isAgentEnabled: () => flags.agent }))
vi.mock('@/lib/agent/trace', () => ({ agentTrace: vi.fn() }))

import { db } from '@/config/db'
import { founderEntitlement } from '@/db/platformEntitlements'
import { admitAiRun } from '@/lib/ai/gate'
import { AGENT_TASK_KIND } from '@/lib/agent/run'
import { addDailySpend, _resetDailySpendForTests } from '@/lib/ai/router/spend'
import { _resetAiEnvCacheForTests } from '@/lib/ai/env'
import { COPY } from '@/lib/waAssistant/render'
import { agencies, harness, owner, reset, run, say, setEnv, teardown, type Owner } from './reminderHarness'

let A: number
let B: number
let seq = 0
const MIN = 60_000

const grant = (o: Owner, over: Record<string, unknown> = {}) =>
  db('platform_entitlements').insert({ agencyId: o.agencyId, userId: o.u, entitlement: 'founder_unlimited_usage', reason: 'test founder', grantedBy: 'test', ...over }).returning('id')

/** Earlier jobs, inserted directly: what the limits count. */
async function seedJobs(o: Owner, n: number, over: { agoMs?: number | ((i: number) => number); question?: string; kind?: string; costUsd?: number } = {}) {
  const rows = Array.from({ length: n }, (_, i) => ({
    wamid: `wamid.__fd_${++seq}`, recipientId: o.r, agencyId: o.agencyId, userId: o.u, kind: over.kind ?? 'text',
    question: over.question ?? `שאלה ${seq}`, messageTimestamp: Math.floor(Date.now() / 1000), status: 'answered',
    costUsd: over.costUsd ?? 0,
    createdAt: new Date(Date.now() - (typeof over.agoMs === 'function' ? over.agoMs(i) : (over.agoMs ?? 30 * MIN))),
  }))
  for (let i = 0; i < rows.length; i += 100) await db('wa_assistant_jobs').insert(rows.slice(i, i + 100))
}

/** One owner message through the real webhook and worker; returns the job's outcome and the reply (if any). */
async function turn(o: Owner, text: string) {
  const h = harness()
  await say(o, text)
  await run(h)
  const job = (await db('wa_assistant_jobs').where({ recipientId: o.r }).orderBy('id', 'desc').first('id', 'status', 'refusalReason')) as { id: number; status: string; refusalReason: string | null }
  const ev = (await db('analytics_events').where({ event: 'wa_assistant_turn' }).orderByRaw('id desc').first('props')) as { props: Record<string, unknown> } | undefined
  return { job, reply: h.sendText.mock.calls.at(-1)?.[0] as { body: string } | undefined, agentRuns: h.runAgent.mock.calls.length, props: ev?.props ?? {} }
}

const PAYMENT = /תשלום|לשלם|מנוי|שדרוג|קרדיט|₪|\$|upgrade|credit/iu

beforeAll(async () => {
  ;[A, B] = await agencies('__fd_a__', '__fd_b__')
})
beforeEach(async () => {
  await db.raw('TRUNCATE platform_entitlements') // row triggers do not fire on TRUNCATE (test cleanup only)
  await reset([A, B])
  setEnv([A, B])
  flags.agent = true
})
afterEach(() => {
  delete process.env.AGENT_EXCLUDED_AGENCY_IDS
})
afterAll(async () => {
  await db.raw('TRUNCATE platform_entitlements') // row triggers do not fire on TRUNCATE (test cleanup only)
  await teardown()
})

describe('the entitlement record', () => {
  it('matches BOTH agency and user, and nothing else', async () => {
    const f = await owner(A)
    const colleague = await owner(A)
    await grant(f)
    expect(await founderEntitlement(A, f.u)).toBe(true)
    expect(await founderEntitlement(A, colleague.u)).toBe(false)
    expect(await founderEntitlement(B, f.u)).toBe(false)
    expect(await founderEntitlement(null, f.u)).toBe(false)
  })

  it('revoked → no entitlement; a revoked grant is final; a grant is never edited or deleted', async () => {
    const f = await owner(A)
    const [{ id }] = await grant(f)
    await expect(db('platform_entitlements').where({ id }).update({ reason: 'changed' })).rejects.toThrow(/never edited/)
    await expect(db('platform_entitlements').where({ id }).del()).rejects.toThrow(/never deleted/)
    await db('platform_entitlements').where({ id }).update({ revokedAt: new Date(), revokedBy: 'test', revokeReason: 'test' })
    expect(await founderEntitlement(A, f.u)).toBe(false)
    await expect(db('platform_entitlements').where({ id }).update({ revokedAt: null, revokedBy: null, revokeReason: null })).rejects.toThrow(/final/)
  })

  it('an unknown entitlement cannot be granted; one active grant per user', async () => {
    const f = await owner(A)
    await expect(grant(f, { entitlement: 'unlimited_everything' })).rejects.toMatchObject({ code: '23514' })
    await grant(f)
    await expect(grant(f)).rejects.toMatchObject({ code: '23505' })
  })

  it('fails closed inside a transaction: the caller’s transaction survives a failed read', async () => {
    const f = await owner(A)
    await grant(f)
    await db.transaction(async (trx) => {
      await trx.raw('ALTER TABLE platform_entitlements RENAME TO platform_entitlements_x')
      expect(await founderEntitlement(A, f.u, trx)).toBe(false)
      // Still usable: the failure was contained in a savepoint.
      expect((await trx.raw('SELECT 1 AS ok')).rows[0].ok).toBe(1)
      await trx.raw('ALTER TABLE platform_entitlements_x RENAME TO platform_entitlements')
      expect(await founderEntitlement(A, f.u, trx)).toBe(true)
    })
  })

  it('fails closed: a database error means normal limits', async () => {
    const broken = (() => {
      throw new Error('db down')
    }) as never
    expect(await founderEntitlement(A, 1, broken)).toBe(false)
  })
})

describe('commercial limits: waived for the founder only', () => {
  it('20 per sender per hour', async () => {
    const f = await owner(A)
    const other = await owner(B)
    await grant(f)
    await seedJobs(f, 20)
    await seedJobs(other, 20)
    const ok = await turn(f, 'כמה לידים חדשים יש היום?')
    expect(ok.job.refusalReason).toBeNull()
    expect(ok.agentRuns).toBe(1)
    expect(ok.props.limitWaived).toEqual(['sender_limit'])
    const no = await turn(other, 'כמה לידים חדשים יש היום?')
    expect(no.job).toMatchObject({ status: 'refused', refusalReason: 'sender_limit' })
    expect(no.reply?.body).toBe(COPY.senderLimit)
  })

  it('200 per agency per day', async () => {
    const f = await owner(A)
    const colleague = await owner(A)
    const filler = await owner(A)
    await grant(f)
    await seedJobs(filler, 200, { agoMs: 2 * MIN })
    expect((await turn(f, 'מה המצב?')).job.refusalReason).toBeNull()
    expect((await turn(colleague, 'מה המצב?')).job.refusalReason).toBe('agency_limit')
  })

  it('the $2/day assistant spend cap', async () => {
    const f = await owner(A)
    const colleague = await owner(A)
    await grant(f)
    await seedJobs(colleague, 1, { costUsd: 2.5, agoMs: 2 * MIN })
    const ok = await turn(f, 'מה המצב?')
    expect(ok.job.refusalReason).toBeNull()
    expect(ok.props.limitWaived).toEqual(['spend_limit'])
    expect((await turn(colleague, 'מה המצב?')).job.refusalReason).toBe('spend_limit')
  })
})

describe('technical abuse protection stays for the founder', () => {
  it.each([
    ['burst: more than 10 in a minute', { n: 10, agoMs: 20_000 }, 'abuse_burst', COPY.abuseBurst],
    ['flood: more than 120 in an hour', { n: 120, agoMs: (i: number) => 2 * MIN + i * 20_000 }, 'abuse_hourly', COPY.abuseHourly],
  ])('%s', async (_name, seed, reason, copy) => {
    const f = await owner(A)
    await grant(f)
    await seedJobs(f, seed.n, { agoMs: seed.agoMs })
    const r = await turn(f, 'מה המצב?')
    expect(r.job).toMatchObject({ status: 'refused', refusalReason: reason })
    expect(r.reply?.body).toBe(copy)
    expect(r.reply?.body).not.toMatch(PAYMENT)
    expect(r.agentRuns).toBe(0)
  })

  it('loop: the 5th CONSECUTIVE identical text within 10 minutes', async () => {
    const f = await owner(A)
    await grant(f)
    await seedJobs(f, 4, { question: 'בדיקה', agoMs: (i) => (4 - i) * MIN })
    const r = await turn(f, 'בדיקה')
    expect(r.job.refusalReason).toBe('abuse_loop')
    expect(r.reply?.body).toBe(COPY.abuseLoop)
    expect(r.reply?.body).not.toMatch(PAYMENT)
  })

  it('identical texts interleaved with button taps or other messages are NOT a loop', async () => {
    const f = await owner(A)
    await grant(f)
    await seedJobs(f, 2, { question: 'בדיקה', agoMs: 5 * MIN })
    await seedJobs(f, 1, { kind: 'decision', question: `wa:approve:${'0'.repeat(32)}`, agoMs: 4 * MIN })
    await seedJobs(f, 2, { question: 'בדיקה', agoMs: 3 * MIN })
    expect((await turn(f, 'בדיקה')).job.refusalReason).toBeNull()
    await seedJobs(f, 1, { question: 'משהו אחר', agoMs: 30_000 })
    expect((await turn(f, 'בדיקה')).job.refusalReason).toBeNull()
  })

  it('a duplicate webhook delivery still makes no second job', async () => {
    const f = await owner(A)
    await grant(f)
    expect(await say(f, 'מה המצב?', 'wamid.__fd_dup')).toBe('assistant_queued')
    expect(await say(f, 'מה המצב?', 'wamid.__fd_dup')).toBe('duplicate')
    expect(await db('wa_assistant_jobs').where({ recipientId: f.r })).toHaveLength(1)
  })
})

describe('product access and AI admission', () => {
  it('a free/expired plan never blocks the verified founder; it still blocks a colleague', async () => {
    const f = await owner(A)
    const colleague = await owner(A)
    await grant(f)
    await db('agencies').where({ id: A }).update({ plan: 'free', planReason: null, trialExempt: false, trialStartedAt: new Date(Date.now() - 30 * 24 * 60 * MIN), trialEndsAt: new Date(Date.now() - 23 * 24 * 60 * MIN) })
    expect((await turn(f, 'מה המצב?')).job.refusalReason).toBeNull()
    const no = await turn(colleague, 'מה המצב?')
    expect(no.job.status).toBe('refused')
    expect(['agent_not_enabled', 'no_product_access']).toContain(no.job.refusalReason)
  })

  it('the per-agency daily AI over-quota is waived for a founder run; AI_ENABLED still stops it', async () => {
    const saved = { enabled: process.env.AI_ENABLED, allow: process.env.AI_AGENCY_ALLOWLIST, key: process.env.ANTHROPIC_API_KEY }
    try {
      process.env.AI_ENABLED = 'true'
      // A synthetic key so the provider check passes and `over-quota` is reached; admission never calls a provider.
      process.env.ANTHROPIC_API_KEY = 'sk-synthetic-test-key-not-real'
      process.env.AI_AGENCY_ALLOWLIST = String(A)
      _resetAiEnvCacheForTests()
      _resetDailySpendForTests()
      addDailySpend(A, 1_000_000)
      const f = await owner(A)
      const colleague = await owner(A)
      await grant(f)
      const normal = await admitAiRun({ kind: AGENT_TASK_KIND, agencyId: A, userId: colleague.u })
      const founder = await admitAiRun({ kind: AGENT_TASK_KIND, agencyId: A, userId: f.u })
      expect(normal).toEqual({ ok: false, reason: 'over-quota' })
      expect(founder.ok).toBe(true)
      process.env.AI_ENABLED = 'false'
      _resetAiEnvCacheForTests()
      expect(await admitAiRun({ kind: AGENT_TASK_KIND, agencyId: A, userId: f.u })).toEqual({ ok: false, reason: 'disabled' })
    } finally {
      process.env.AI_ENABLED = saved.enabled
      process.env.AI_AGENCY_ALLOWLIST = saved.allow
      if (saved.enabled === undefined) delete process.env.AI_ENABLED
      if (saved.allow === undefined) delete process.env.AI_AGENCY_ALLOWLIST
      if (saved.key === undefined) delete process.env.ANTHROPIC_API_KEY
      else process.env.ANTHROPIC_API_KEY = saved.key
      _resetAiEnvCacheForTests()
      _resetDailySpendForTests()
    }
  })

  it('emergency controls still stop the founder: the Agent exclusion list and the rollout', async () => {
    const f = await owner(A)
    await grant(f)
    process.env.AGENT_EXCLUDED_AGENCY_IDS = String(A)
    expect((await turn(f, 'מה המצב?')).job.refusalReason).toBe('agent_not_enabled')
    delete process.env.AGENT_EXCLUDED_AGENCY_IDS
    flags.agent = false
    expect((await turn(f, 'מה המצב?')).job.refusalReason).toBe('agent_not_enabled')
  })

  it('revocation applies to the next message', async () => {
    const f = await owner(A)
    const [{ id }] = await grant(f)
    await seedJobs(f, 20)
    expect((await turn(f, 'מה המצב?')).job.refusalReason).toBeNull()
    await db('platform_entitlements').where({ id }).update({ revokedAt: new Date(), revokedBy: 'test', revokeReason: 'test' })
    expect((await turn(f, 'מה המצב?')).job.refusalReason).toBe('sender_limit')
  })
})
