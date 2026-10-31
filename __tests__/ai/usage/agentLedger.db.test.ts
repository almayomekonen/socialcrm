import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Roles } from '@/types/roles'
import type { AgentScope } from '@/lib/agent/types'

/**
 * The Agent path of the usage ledger, against a real PostgreSQL: every
 * generateText STEP is one provider request (one row), both phases of a
 * two-phase run share one invocation, the investigation is the operation unless
 * a worker set one, and a run that throws is recorded with unknown usage.
 * The SDK and admission are mocked; no provider is contacted.
 */
const generateText = vi.hoisted(() => vi.fn())
vi.mock('ai', async (i) => ({ ...(await i<typeof import('ai')>()), generateText }))
vi.mock('@/lib/ai/gate', () => ({
  AGENT_TASK_KIND: 'agent.investigate',
  admitAiRun: async () => ({
    ok: true,
    effectiveRole: 'primary',
    cfg: { role: 'primary', maxOutputTokens: 1200, providerMaxRetries: 0 },
    chain: [{ provider: 'openai', modelId: 'gpt-5.6', model: { id: 'm' } }],
  }),
}))
vi.mock('@/lib/ai/router/spend', () => ({ addDailySpend: vi.fn(), getDailySpend: () => 0 }))

import { db } from '@/config/db'
import { runAgentInvestigation } from '@/lib/agent/run'
import { withAiOperation } from '@/lib/ai/usage/context'

const AGENCY = 9201
const SCOPE: AgentScope = { agencyId: AGENCY, userId: 1, role: Roles.ADMIN, gotPermIds: [], plan: 'pro', firstName: 'א' }
const ANSWER = { headline: 'h', claims: [], unknown: 'לא ידוע' }
const step = (id: string, input: number, output: number, hosted = 0) => ({
  usage: {
    inputTokens: input,
    outputTokens: output,
    inputTokenDetails: { noCacheTokens: input, cacheReadTokens: 0, cacheWriteTokens: 0 },
  },
  response: { id, modelId: 'gpt-5.6-sol' },
  providerMetadata: { openai: { serviceTier: 'default' } },
  finishReason: 'stop',
  toolCalls: Array.from({ length: hosted }, () => ({ providerExecuted: true })),
})
const rows = () => db('ai_usage_events').where({ agencyId: AGENCY }).orderBy('stepIndex')

beforeEach(async () => {
  process.env.AI_USAGE_LEDGER = '1'
  generateText.mockReset()
  await db('ai_usage_events').where({ agencyId: AGENCY }).del()
})
afterAll(async () => {
  delete process.env.AI_USAGE_LEDGER
  await db('ai_usage_events').where({ agencyId: AGENCY }).del()
})

describe('Agent usage ledger', () => {
  it('one row per step; the investigation is the operation', async () => {
    generateText.mockResolvedValueOnce({
      output: ANSWER,
      steps: [step('s1', 1_000, 100), step('s2', 2_000, 200)],
      totalUsage: { inputTokens: 3_000, outputTokens: 300 },
      finishReason: 'stop',
      response: { messages: [] },
    })
    const res = await runAgentInvestigation({ question: 'q', scope: SCOPE, investigationId: 'inv_test_1' })
    const r = await rows()
    expect(r.map((x) => [x.stepIndex, x.providerRequestId, x.inputTokens, x.costBasis])).toEqual([
      [0, 's1', 1_000, 'reported_usage'],
      [1, 's2', 2_000, 'reported_usage'],
    ])
    expect(r[0]).toMatchObject({
      operationKind: 'agent_investigation',
      operationId: 'inv_test_1',
      feature: 'agent.investigate',
      requestedModel: 'gpt-5.6',
      responseModel: 'gpt-5.6-sol',
      userId: 1,
    })
    expect(r[0].invocationId).toBe(r[1].invocationId)
    expect(res.investigationId).toBe('inv_test_1')
  })

  it('two phases share one invocation and number their steps continuously; hosted searches are counted', async () => {
    generateText
      .mockResolvedValueOnce({
        text: 'p1',
        steps: [step('p1a', 500, 50, 2)],
        totalUsage: { inputTokens: 500, outputTokens: 50 },
        finishReason: 'stop',
        response: { messages: [] },
      })
      .mockResolvedValueOnce({
        output: ANSWER,
        steps: [step('p2a', 300, 40)],
        totalUsage: { inputTokens: 300, outputTokens: 40 },
        finishReason: 'stop',
        response: { messages: [] },
      })
    await withAiOperation({ kind: 'wa_assistant_job', id: '55', agencyId: AGENCY }, () =>
      runAgentInvestigation({ question: 'q', scope: SCOPE, requireToolEvidence: true, maxSteps: 4 }),
    )
    const r = await rows()
    expect(r.map((x) => [x.stepIndex, x.providerRequestId, x.webSearchCalls, x.operationKind, x.operationId])).toEqual([
      [0, 'p1a', 2, 'wa_assistant_job', '55'],
      [1, 'p2a', 0, 'wa_assistant_job', '55'],
    ])
    expect(new Set(r.map((x) => x.invocationId)).size).toBe(1)
  })

  it('a run that throws is recorded with unknown usage, never zero', async () => {
    generateText.mockRejectedValueOnce(
      Object.assign(new Error('provider down: sk-should-not-be-stored'), { name: 'AI_APICallError' }),
    )
    const res = await runAgentInvestigation({ question: 'q', scope: SCOPE })
    expect(res.ok).toBe(false)
    const [r] = await rows()
    expect(r).toMatchObject({
      status: 'error',
      errorCode: 'AI_APICallError',
      usageReported: false,
      costUsd: null,
      costBasis: 'unknown',
    })
    expect(JSON.stringify(r)).not.toContain('sk-should-not-be-stored')
  })
})
