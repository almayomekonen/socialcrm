import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Roles } from '@/types/roles'
import type { AgentScope } from '@/lib/agent/types'

/**
 * Budget SHADOW on the Agent path, against a real PostgreSQL: one reservation
 * per generateText call (each may run several steps), a PARTIAL bound, each
 * step priced on its own and summed — equal to the step ledger rows — and a
 * thrown run settled as failed. The answer is unaffected. SDK and admission
 * are mocked.
 */
const generateText = vi.hoisted(() => vi.fn())
vi.mock('ai', async (i) => ({ ...(await i<typeof import('ai')>()), generateText }))
vi.mock('@/lib/ai/gate', () => ({
  AGENT_TASK_KIND: 'agent.investigate',
  admitAiRun: async () => ({
    ok: true,
    effectiveRole: 'primary',
    cfg: { role: 'primary', maxOutputTokens: 1200, providerMaxRetries: 0 },
    chain: [{ provider: 'openai', modelId: 'gpt-5.6-sol', model: { id: 'm' } }],
  }),
}))
vi.mock('@/lib/ai/router/spend', () => ({ addDailySpend: vi.fn(), getDailySpend: () => 0 }))

import { db } from '@/config/db'
import { runAgentInvestigation } from '@/lib/agent/run'
import { withAiOperation } from '@/lib/ai/usage/context'

const AGENCY = 9601
const SCOPE: AgentScope = { agencyId: AGENCY, userId: 1, role: Roles.ADMIN, gotPermIds: [], plan: 'pro', firstName: 'א' }
const ANSWER = { headline: 'h', claims: [], unknown: 'לא ידוע' }
const total = {
  inputTokens: 2_000,
  outputTokens: 200,
  inputTokenDetails: { noCacheTokens: 2_000, cacheReadTokens: 0, cacheWriteTokens: 0 },
}
const step = (input: number, over: Record<string, unknown> = {}) => ({
  usage: {
    inputTokens: input,
    outputTokens: 100,
    inputTokenDetails: { noCacheTokens: input, cacheReadTokens: 0, cacheWriteTokens: 0 },
  },
  response: { id: `s${input}`, modelId: 'gpt-5.6-sol' },
  providerMetadata: { openai: { serviceTier: 'default' } },
  finishReason: 'stop',
  ...over,
})
const done = (steps: unknown[], extra: Record<string, unknown> = { output: ANSWER }) => ({
  ...extra,
  steps,
  totalUsage: total,
  finishReason: 'stop',
  response: { messages: [] },
})
const rows = () => db('ai_budget_reservations').where({ agencyId: AGENCY }).orderBy('id')
const ledgerRows = () => db('ai_usage_events').where({ agencyId: AGENCY }).orderBy('stepIndex')
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
  generateText.mockReset()
  await db('ai_budget_reservations').where({ agencyId: AGENCY }).del()
  await db('ai_usage_events').where({ agencyId: AGENCY }).del()
})
afterAll(async () => {
  delete process.env.AI_BUDGET_SHADOW
  delete process.env.AI_USAGE_LEDGER
  await db('ai_budget_reservations').where({ agencyId: AGENCY }).del()
  await db('ai_usage_events').where({ agencyId: AGENCY }).del()
  await db('ai_budget_counters').where('scopeKey', 'like', `%${AGENCY}%`).del()
})

describe('Agent run identity', () => {
  it('/agent (askAgent → no id passed): the server-generated investigation is the run of every call', async () => {
    generateText.mockResolvedValueOnce(done([step(1_000), step(1_000)]))
    const res = await runAgentInvestigation({ question: 'q', scope: SCOPE })
    await settled()
    const [r] = await rows()
    expect(r).toMatchObject({ operationKind: 'agent_investigation', operationId: res.investigationId })
    expect(r.scopesSkipped).not.toContain('run')
  })

  it('investigation admission (autonomous, two phases): both phases are one run; another investigation is another', async () => {
    generateText
      .mockResolvedValueOnce(done([step(1_000)], { text: 'p1' }))
      .mockResolvedValueOnce(done([step(1_000)]))
      .mockResolvedValueOnce(done([step(1_000)], { text: 'p1' }))
      .mockResolvedValueOnce(done([step(1_000)]))
    const opts = { question: 'q', scope: SCOPE, requireToolEvidence: true, skipInteractiveSpend: true, maxSteps: 4 }
    const a = await runAgentInvestigation(opts)
    const b = await runAgentInvestigation(opts)
    await settled()
    const r = await rows()
    expect(r.map((x) => x.operationId)).toEqual([a.investigationId, a.investigationId, b.investigationId, b.investigationId])
    expect(a.investigationId).not.toBe(b.investigationId)
    const run = await db('ai_budget_counters')
      .where({ scopeKey: `run:a${AGENCY}:agent_investigation:${a.investigationId}`, windowKind: 'run' })
      .first()
    expect(run.requests).toBe(2)
  })

  it('inside a worker job (the WhatsApp assistant): the job is the run', async () => {
    generateText.mockResolvedValueOnce(done([step(1_000)]))
    await withAiOperation({ kind: 'wa_assistant_job', id: '9001', agencyId: AGENCY }, () =>
      runAgentInvestigation({ question: 'q', scope: SCOPE }),
    )
    await settled()
    expect(await rows()).toEqual([expect.objectContaining({ operationKind: 'wa_assistant_job', operationId: '9001' })])
  })

  it('a run that throws is still attributed to its investigation', async () => {
    generateText.mockRejectedValueOnce(Object.assign(new Error('down'), { name: 'AI_APICallError' }))
    const res = await runAgentInvestigation({ question: 'q', scope: SCOPE, investigationId: 'inv_throw_1' })
    await settled()
    expect(res.investigationId).toBe('inv_throw_1')
    expect(await rows()).toEqual([expect.objectContaining({ state: 'failed', operationId: 'inv_throw_1' })])
  })
})

describe('Agent shadow reservations', () => {
  it('interactive: one reservation, partial bound, reconciled with its step', async () => {
    generateText.mockResolvedValueOnce(done([step(2_000, { usage: { ...step(2_000).usage, outputTokens: 200 } })]))
    const res = await runAgentInvestigation({ question: 'q', scope: SCOPE, investigationId: 'inv_shadow_1' })
    expect(res.investigationId).toBe('inv_shadow_1')
    await settled()
    const r = await rows()
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({
      feature: 'agent.investigate',
      estimateBasis: 'partial',
      costMetadataIncomplete: true,
      state: 'reconciled',
    })
    expect(Number(r[0].actualUsd)).toBeCloseTo((2_000 * 4 + 200 * 20) / 1e6, 6)
    expect(r[0]).toMatchObject({ actualCostBasis: 'reported_usage', stepIndexFrom: 0, stepCount: 1 })
  })

  it('3 steps of 100K (300K in total): each priced at STANDARD rates, the sum equals the ledger rows', async () => {
    generateText.mockResolvedValueOnce(done([step(100_000), step(100_000), step(100_000)]))
    await runAgentInvestigation({ question: 'q', scope: SCOPE })
    await settled()
    const [r] = await rows()
    const ledger = await ledgerRows()
    expect(ledger).toHaveLength(3)
    const ledgerSum = ledger.reduce((n, x) => n + Number(x.costUsd), 0)
    expect(Number(r.actualUsd)).toBeCloseTo(3 * ((100_000 * 4 + 100 * 20) / 1e6), 9) // not the >272K long-context rates
    expect(Number(r.actualUsd)).toBeCloseTo(ledgerSum, 9)
    expect(r).toMatchObject({
      state: 'reconciled',
      actualCostBasis: 'reported_usage',
      invocationId: ledger[0].invocationId,
      stepIndexFrom: 0,
      stepCount: 3,
      responseModels: ['gpt-5.6-sol'],
    })
  })

  it('mixed tiers: an unreported tier makes the sum estimated; a non-Standard one makes it unknown', async () => {
    generateText
      .mockResolvedValueOnce(done([step(1_000), step(1_000, { providerMetadata: undefined })]))
      .mockResolvedValueOnce(done([step(1_000), step(1_000, { providerMetadata: { openai: { serviceTier: 'flex' } } })]))
    await runAgentInvestigation({ question: 'q', scope: SCOPE })
    await runAgentInvestigation({ question: 'q', scope: SCOPE })
    await settled()
    const [a, b] = await rows()
    expect(a).toMatchObject({ state: 'reconciled', actualCostBasis: 'estimated', actualCostNote: 'service_tier_unreported' })
    expect(b).toMatchObject({ state: 'unknown_cost', actualUsd: null, actualCostBasis: 'unknown' })
    expect(b.actualCostNote).toBe('step_cost_unknown:1/2,unpriced_service_tier:flex')
    expect(Number(b.chargedUsd)).toBe(Number(b.estimateUsd)) // charged the estimate, never a partial sum or zero
  })

  it('missing step metadata: a step without usage makes the call unknown; no steps at all is an estimate', async () => {
    generateText.mockResolvedValueOnce(done([step(1_000), step(1_000, { usage: undefined })]))
    await runAgentInvestigation({ question: 'q', scope: SCOPE })
    generateText.mockResolvedValueOnce(done([]))
    await runAgentInvestigation({ question: 'q', scope: SCOPE })
    await settled()
    const [a, b] = await rows()
    expect(a).toMatchObject({
      state: 'unknown_cost',
      actualCostBasis: 'unknown',
      actualCostNote: 'step_cost_unknown:1/2,usage_missing',
    })
    expect(b).toMatchObject({ state: 'reconciled', actualCostBasis: 'estimated', stepCount: 0 })
    expect(b.actualCostNote).toContain('step_breakdown_missing')
  })

  it('two phases: two reservations, each linked to its own ledger steps', async () => {
    generateText
      .mockResolvedValueOnce(done([step(1_000), step(2_000)], { text: 'p1' }))
      .mockResolvedValueOnce(done([step(3_000)]))
    await runAgentInvestigation({ question: 'q', scope: SCOPE, requireToolEvidence: true, maxSteps: 4 })
    await settled()
    const r = await rows()
    expect(r.map((x) => [x.state, x.stepIndexFrom, x.stepCount])).toEqual([
      ['reconciled', 0, 2],
      ['reconciled', 2, 1],
    ])
    const ledger = await ledgerRows()
    expect(ledger.map((x) => x.stepIndex)).toEqual([0, 1, 2])
    const sumOf = (from: number, n: number) =>
      ledger.filter((x) => x.stepIndex >= from && x.stepIndex < from + n).reduce((s, x) => s + Number(x.costUsd), 0)
    expect(Number(r[0].actualUsd)).toBeCloseTo(sumOf(0, 2), 9)
    expect(Number(r[1].actualUsd)).toBeCloseTo(sumOf(2, 1), 9)
  })

  it('a run that throws is settled as failed and charged its estimate; the run reports failure as before', async () => {
    generateText.mockRejectedValueOnce(Object.assign(new Error('down'), { name: 'AI_APICallError' }))
    const res = await runAgentInvestigation({ question: 'q', scope: SCOPE })
    expect(res.ok).toBe(false)
    await settled()
    const [r] = await rows()
    expect(r).toMatchObject({ state: 'failed', actualUsd: null, actualCostBasis: 'unknown', stepIndexFrom: 0, stepCount: 1 })
    expect(Number(r.chargedUsd)).toBe(Number(r.estimateUsd))
    const [row] = await ledgerRows()
    expect(row).toMatchObject({ status: 'error', costBasis: 'unknown', stepIndex: 0, invocationId: r.invocationId })
  })
})
