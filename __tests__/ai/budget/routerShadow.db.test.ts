import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

/**
 * Budget SHADOW through the real router: a would-deny never stops, delays or
 * changes the provider call; each attempt (retry/fallback) gets its own
 * reservation, settled honestly; the reservation shares its callId with the
 * usage-ledger row; the contact is a hash. Only the SDK and admission are mocked.
 */
const ai = vi.hoisted(() => ({ generateObject: vi.fn() }))
vi.mock('ai', async (orig) => ({ ...(await orig<typeof import('ai')>()), generateObject: ai.generateObject }))
const chain = vi.hoisted(() => ({
  value: [
    { provider: 'openai', modelId: 'gpt-5.6-sol', model: {} },
    { provider: 'anthropic', modelId: 'claude-sonnet-4-6', model: {} },
  ] as { provider: string; modelId: string; model: object }[],
}))
vi.mock('@/lib/ai/gate', () => ({
  admitAiRun: async () => ({
    ok: true,
    effectiveRole: 'primary',
    cfg: { maxOutputTokens: 500, timeoutMs: 5_000, retryOnSameProvider: 0, providerMaxRetries: 0 },
    chain: chain.value,
  }),
}))

// The real reservation store, with a switch to make settlement fail (a database outage).
const budget = vi.hoisted(() => ({ failSettle: false }))
vi.mock('@/db/aiBudget', async (orig) => {
  const m = await orig<typeof import('@/db/aiBudget')>()
  return {
    ...m,
    settleShadow: async (i: Parameters<typeof m.settleShadow>[0]) => {
      if (budget.failSettle) throw Object.assign(new Error('db down'), { name: 'KnexTimeoutError' })
      return m.settleShadow(i)
    },
  }
})

import { db } from '@/config/db'
import { expireStaleShadowReservations } from '@/db/aiBudget'
import { runStructured } from '@/lib/ai/router'
import { withAiOperation } from '@/lib/ai/usage/context'
import { agency, cleanup, conversation } from '../../ownerWhatsappReminders/reminderFixtures'

const AGENCY = 9501
const SCHEMA = z.object({ x: z.string() })
const call = () =>
  runStructured({ kind: 'inbox.autoResponse', schema: SCHEMA, system: 'שלום', user: 'מה המחיר?', agencyId: AGENCY })
const usage = {
  inputTokens: 1_000,
  outputTokens: 100,
  inputTokenDetails: { noCacheTokens: 1_000, cacheReadTokens: 0, cacheWriteTokens: 0 },
}
const ok = (modelId = 'gpt-5.6-sol') => ({ object: { x: 'a' }, usage, response: { id: 'r1', modelId }, finishReason: 'stop' })
const reservations = () => db('ai_budget_reservations').where({ agencyId: AGENCY }).orderBy('id')
const settled = async () => {
  for (let i = 0; i < 40; i++) {
    const open = await db('ai_budget_reservations')
      .where({ agencyId: AGENCY, state: 'reserved' })
      .count<{ count: string }>('* as count')
      .first()
    if (Number(open?.count) === 0) return
    await new Promise((r) => setTimeout(r, 25))
  }
}

beforeEach(async () => {
  process.env.AI_BUDGET_SHADOW = '1'
  process.env.AI_USAGE_LEDGER = '1'
  delete process.env.AI_BUDGET_POLICY
  budget.failSettle = false
  ai.generateObject.mockReset()
  chain.value = [
    { provider: 'openai', modelId: 'gpt-5.6-sol', model: {} },
    { provider: 'anthropic', modelId: 'claude-sonnet-4-6', model: {} },
  ]
  await db('ai_budget_reservations').where({ agencyId: AGENCY }).del()
  await db('ai_usage_events').where({ agencyId: AGENCY }).del()
})
afterAll(async () => {
  for (const k of ['AI_BUDGET_SHADOW', 'AI_USAGE_LEDGER', 'AI_BUDGET_POLICY']) delete process.env[k]
  await db('ai_budget_reservations').where({ agencyId: AGENCY }).del()
  await db('ai_usage_events').where({ agencyId: AGENCY }).del()
  await db('ai_budget_counters').where('scopeKey', 'like', `%${AGENCY}%`).del()
  await cleanup()
})

describe('shadow never blocks', () => {
  it('a would-deny still makes the identical provider call and returns its answer', async () => {
    process.env.AI_BUDGET_POLICY = JSON.stringify({ version: 'deny-all', perRequestMaxUsd: 0 })
    ai.generateObject.mockResolvedValueOnce(ok())
    const res = await call()
    expect(res).toMatchObject({ ok: true, data: { x: 'a' } })
    expect(ai.generateObject).toHaveBeenCalledTimes(1)
    expect(ai.generateObject.mock.calls[0][0]).toMatchObject({ system: 'שלום', maxOutputTokens: 500 })
    await settled()
    const [r] = await reservations()
    expect(r).toMatchObject({
      mode: 'shadow',
      decision: 'would_deny',
      denyReasons: ['request_max'],
      policyVersion: 'deny-all',
      state: 'reconciled',
      // The schema is counted, but the provider's own wrapping of it is not measurable: partial.
      estimateBasis: 'partial',
    })
    // Estimate: bytes(system+user+schema) at max(input, cacheWrite) + 500 output at $20 — ≥ the actual here
    expect(Number(r.estimateUsd)).toBeGreaterThanOrEqual(Number(r.actualUsd))
    const [ledger] = await db('ai_usage_events').where({ agencyId: AGENCY })
    expect(ledger.callId).toBe(r.callId)
  })

  it('a broken shadow store changes nothing for the request, and the failure is observable without it', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    ai.generateObject.mockResolvedValueOnce(ok())
    await db.raw('ALTER TABLE ai_budget_reservations RENAME TO ai_budget_reservations_hidden')
    try {
      expect((await call()).ok).toBe(true)
      expect(ai.generateObject).toHaveBeenCalledTimes(1) // never retried because recording failed
      await new Promise((r) => setTimeout(r, 100))
      const events = err.mock.calls.filter((c) => c[0] === '[ai-budget]').map((c) => JSON.parse(String(c[1])))
      const [ledger] = await db('ai_usage_events').where({ agencyId: AGENCY })
      expect(events).toEqual([
        expect.objectContaining({
          evt: 'reservation_failed',
          reason: 'db_schema_missing',
          errorCode: '42P01',
          callId: ledger.callId, // the same id as the ledger row, which was still written
          invocationId: ledger.invocationId,
          agencyId: AGENCY,
          feature: 'inbox.autoResponse',
          provider: 'openai',
        }),
      ])
      expect(JSON.stringify(err.mock.calls)).not.toContain('does not exist') // no raw database text
    } finally {
      await db.raw('ALTER TABLE ai_budget_reservations_hidden RENAME TO ai_budget_reservations')
      err.mockRestore()
    }
  })

  it('flag absent: no reservation at all', async () => {
    delete process.env.AI_BUDGET_SHADOW
    ai.generateObject.mockResolvedValueOnce(ok())
    expect((await call()).ok).toBe(true)
    expect(await reservations()).toHaveLength(0)
  })
})

describe('retries, fallbacks and unknown cost', () => {
  it('each attempt is reserved; the timed-out one is charged its estimate, the fallback its actual', async () => {
    ai.generateObject.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce(ok('claude-sonnet-4-6'))
    expect((await call()).ok).toBe(true)
    await settled()
    const [first, second] = await reservations()
    expect(first).toMatchObject({ provider: 'openai', state: 'failed', actualUsd: null })
    expect(Number(first.chargedUsd)).toBe(Number(first.estimateUsd))
    expect(second).toMatchObject({ provider: 'anthropic', state: 'reconciled' })
  })

  it('an unpriced model: unbounded estimate (would-deny by policy), unknown cost charged at the reserve', async () => {
    chain.value = [{ provider: 'openai', modelId: 'gpt-9-preview', model: {} }]
    ai.generateObject.mockResolvedValueOnce({ object: { x: 'a' }, usage: undefined, response: {}, finishReason: 'stop' })
    expect((await call()).ok).toBe(true)
    await settled()
    const [r] = await reservations()
    expect(r).toMatchObject({
      estimateBasis: 'unbounded',
      costMetadataIncomplete: true,
      decision: 'would_deny',
      denyReasons: ['max_cost_unbounded'],
      state: 'unknown_cost',
    })
    expect(Number(r.chargedUsd)).toBe(0.1)
  })
})

describe('cost basis and the ledger link', () => {
  it('the reservation settles on the SAME verdict as its ledger row, and links to it', async () => {
    // The usage shape @ai-sdk/openai 3.0.x really produces: no cacheWriteTokens.
    const sdkUsage = { inputTokens: 1_000, outputTokens: 100, inputTokenDetails: { noCacheTokens: 1_000, cacheReadTokens: 0 } }
    ai.generateObject.mockResolvedValueOnce({
      ...ok(),
      usage: sdkUsage,
      providerMetadata: { openai: { serviceTier: 'default' } },
    })
    expect((await call()).ok).toBe(true)
    await settled()
    const [r] = await reservations()
    const [row] = await db('ai_usage_events').where({ agencyId: AGENCY })
    // OpenAI never reports a cache-write count: an estimate, never presented as reported usage.
    expect(row).toMatchObject({ costBasis: 'estimated', costNote: 'cache_write_unreported' })
    expect(r).toMatchObject({
      actualCostBasis: row.costBasis,
      actualCostNote: row.costNote,
      actualPriceVersion: row.priceVersion,
      invocationId: row.invocationId,
      responseModels: ['gpt-5.6-sol'],
      stepIndexFrom: 0,
      stepCount: 1,
    })
    expect(Number(r.actualUsd)).toBe(Number(row.costUsd))
    expect(r.callId).toBe(row.callId)
  })

  it('ledger off: no ledger rows, and the reservation is still reconcilable on its own', async () => {
    delete process.env.AI_USAGE_LEDGER
    ai.generateObject.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce(ok('claude-sonnet-4-6'))
    expect((await call()).ok).toBe(true)
    await settled()
    expect(await db('ai_usage_events').where({ agencyId: AGENCY })).toHaveLength(0)
    const [first, second] = await reservations()
    expect(first).toMatchObject({ state: 'failed', actualCostBasis: 'unknown', actualCostNote: 'usage_missing', stepCount: 1 })
    expect(second).toMatchObject({ state: 'reconciled', actualCostBasis: 'estimated', responseModels: ['claude-sonnet-4-6'] })
    expect(first.invocationId).toBeTruthy()
    expect(first.invocationId).toBe(second.invocationId) // one invocation, two attempts
    expect(first.callId).not.toBe(second.callId)
  })

  it('a larger schema reserves more', async () => {
    const big = z.object(
      Object.fromEntries(Array.from({ length: 60 }, (_, k) => [`field_${k}`, z.string().describe('x'.repeat(40))])),
    )
    ai.generateObject.mockResolvedValue(ok())
    await call()
    await runStructured({ kind: 'inbox.autoResponse', schema: big, system: 'שלום', user: 'מה המחיר?', agencyId: AGENCY })
    await settled()
    const [small, large] = await reservations()
    expect(Number(large.estimateUsd)).toBeGreaterThan(Number(small.estimateUsd))
    expect(large).toMatchObject({ estimateBasis: 'partial', estimatePriceVersion: expect.any(String) })
  })
})

describe('run identity', () => {
  it('an interactive call: every attempt and fallback is ONE run (its invocation); another call is another run', async () => {
    ai.generateObject.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce(ok('claude-sonnet-4-6'))
    await call()
    ai.generateObject.mockResolvedValueOnce(ok())
    await call()
    await settled()
    const [a1, a2, b] = await reservations()
    expect(a1.operationId).toBeTruthy()
    expect([a1.operationKind, a2.operationKind]).toEqual(['inbox.autoResponse', 'inbox.autoResponse'])
    expect(a2.operationId).toBe(a1.operationId)
    expect(a1.operationId).toBe(a1.invocationId) // the ledger's operation for a call with no worker context
    expect(b.operationId).not.toBe(a1.operationId)
    expect(a1.scopesSkipped).not.toContain('run')
    const run = await db('ai_budget_counters')
      .where({ scopeKey: `run:a${AGENCY}:inbox.autoResponse:${a1.operationId}`, windowKind: 'run' })
      .first()
    expect(run.requests).toBe(2)
  })

  it('a per-run limit sees the retry: the fallback of an over-limit run is a would-deny (the call still happens)', async () => {
    process.env.AI_BUDGET_POLICY = JSON.stringify({ version: 'run-cap', perRunUsd: 0.012 })
    ai.generateObject.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce(ok('claude-sonnet-4-6'))
    expect((await call()).ok).toBe(true)
    expect(ai.generateObject).toHaveBeenCalledTimes(2)
    await settled()
    const [first, second] = await reservations()
    expect(first.decision).toBe('would_allow')
    expect(second).toMatchObject({ decision: 'would_deny', denyReasons: ['run_limit'] })
  })

  it('inside a worker job, every call of the job is that job’s run', async () => {
    ai.generateObject.mockResolvedValue(ok())
    await withAiOperation({ kind: 'auto_response_job', id: '4242', agencyId: AGENCY }, async () => {
      await call()
      await call()
    })
    await settled()
    expect((await reservations()).map((r) => [r.operationKind, r.operationId])).toEqual([
      ['auto_response_job', '4242'],
      ['auto_response_job', '4242'],
    ])
  })
})

describe('settlement failure and recovery', () => {
  it('a settlement that keeps failing never repeats the provider call; the expiry sweep recovers it from the ledger', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    budget.failSettle = true
    ai.generateObject.mockResolvedValueOnce({ ...ok(), providerMetadata: { openai: { serviceTier: 'default' } } })
    expect((await call()).ok).toBe(true)
    await new Promise((r) => setTimeout(r, 700)) // the three settle attempts
    expect(ai.generateObject).toHaveBeenCalledTimes(1)
    const [open] = await reservations()
    expect(open.state).toBe('reserved')
    budget.failSettle = false
    await db('ai_budget_reservations')
      .where({ callId: open.callId })
      .update({ reservedAt: new Date(Date.now() - 60 * 60_000) })
    await expireStaleShadowReservations(new Date(), 15)
    const [r] = await reservations()
    const [row] = await db('ai_usage_events').where({ agencyId: AGENCY })
    expect(r).toMatchObject({ state: 'reconciled', actualCostBasis: row.costBasis })
    expect(r.actualCostNote).toMatch(/^recovered_from_ledger/)
    expect(Number(r.actualUsd)).toBe(Number(row.costUsd))
    expect(ai.generateObject).toHaveBeenCalledTimes(1)
    err.mockRestore()
  })
})

describe('identity', () => {
  it('the operation, conversation and a HASHED contact come from the server-side context', async () => {
    await agency('__budget_shadow__', AGENCY)
    const conv = await conversation(AGENCY, { lead: false })
    ai.generateObject.mockResolvedValueOnce(ok())
    await withAiOperation({ kind: 'auto_response_job', id: '42', agencyId: AGENCY, conversationId: conv.id }, call)
    await settled()
    const [r] = await reservations()
    expect(r).toMatchObject({ operationKind: 'auto_response_job', operationId: '42', conversationId: String(conv.id) })
    expect(r.contactKey).toMatch(/^[0-9a-f]{32}$/)
    expect(JSON.stringify(r)).not.toContain(conv.customerWaId)
  })
})
