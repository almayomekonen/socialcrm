import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Roles } from '@/types/roles'
import type { AgentScope } from '@/lib/agent/types'

/**
 * Budget SHADOW on the Agent path, against a real PostgreSQL: one reservation
 * per generateText call (each may run several steps), a PARTIAL bound, the
 * call's total usage reconciled afterwards, and a thrown run settled as failed.
 * The answer is unaffected. SDK and admission are mocked.
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

const AGENCY = 9601
const SCOPE: AgentScope = { agencyId: AGENCY, userId: 1, role: Roles.ADMIN, gotPermIds: [], plan: 'pro', firstName: 'א' }
const ANSWER = { headline: 'h', claims: [], unknown: 'לא ידוע' }
const total = {
  inputTokens: 2_000,
  outputTokens: 200,
  inputTokenDetails: { noCacheTokens: 2_000, cacheReadTokens: 0, cacheWriteTokens: 0 },
}
const rows = () => db('ai_budget_reservations').where({ agencyId: AGENCY }).orderBy('id')
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
  generateText.mockReset()
  await db('ai_budget_reservations').where({ agencyId: AGENCY }).del()
})
afterAll(async () => {
  delete process.env.AI_BUDGET_SHADOW
  await db('ai_budget_reservations').where({ agencyId: AGENCY }).del()
  await db('ai_budget_counters').where('scopeKey', 'like', `%${AGENCY}%`).del()
})

describe('Agent shadow reservations', () => {
  it('interactive: one reservation, partial bound, reconciled with the call total', async () => {
    generateText.mockResolvedValueOnce({
      output: ANSWER,
      steps: [{ response: { modelId: 'gpt-5.6-sol' } }],
      totalUsage: total,
      finishReason: 'stop',
      response: { messages: [] },
    })
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
  })

  it('two phases: two reservations', async () => {
    generateText
      .mockResolvedValueOnce({ text: 'p1', steps: [], totalUsage: total, finishReason: 'stop', response: { messages: [] } })
      .mockResolvedValueOnce({ output: ANSWER, steps: [], totalUsage: total, finishReason: 'stop', response: { messages: [] } })
    await runAgentInvestigation({ question: 'q', scope: SCOPE, requireToolEvidence: true, maxSteps: 4 })
    await settled()
    expect((await rows()).map((r) => r.state)).toEqual(['reconciled', 'reconciled'])
  })

  it('a run that throws is settled as failed and charged its estimate; the run reports failure as before', async () => {
    generateText.mockRejectedValueOnce(Object.assign(new Error('down'), { name: 'AI_APICallError' }))
    const res = await runAgentInvestigation({ question: 'q', scope: SCOPE })
    expect(res.ok).toBe(false)
    await settled()
    const [r] = await rows()
    expect(r.state).toBe('failed')
    expect(Number(r.chargedUsd)).toBe(Number(r.estimateUsd))
  })
})
