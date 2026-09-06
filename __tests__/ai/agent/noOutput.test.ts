/**
 * The model can finish without producing an answer, and that must not be a crash.
 *
 * WHAT HAPPENED. `result.output` is a GETTER on the SDK's result, and it THROWS
 * `AI_NoOutputGeneratedError` when generation stopped before the structured
 * payload was emitted — `finishReason: 'length'`, the output budget spent on
 * reasoning. It was read after the try/catch that guards generation, so the
 * throw escaped `runAgentInvestigation`: the caller got an exception rather than
 * an `AgentResult`, nothing was persisted, and the tokens were already paid for.
 *
 * Question D7 of the Phase 3a evaluation hit it — 1,367 output tokens, no
 * payload — and took the remaining four questions of the run down with it.
 *
 * THE OUTCOME IT SHOULD PRODUCE already exists: an answer that is not
 * well-formed is `malformed`, which the rejection path knows how to persist,
 * trace and return. Nothing is repaired; the run is reported as having produced
 * no usable answer.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const resolveAgentScope = vi.hoisted(() => vi.fn())
const admitAiRun = vi.hoisted(() => vi.fn())
const generateTextSpy = vi.hoisted(() => vi.fn())
const addDailySpend = vi.hoisted(() => vi.fn())
const agentTrace = vi.hoisted(() => vi.fn())

vi.mock('@/lib/agent/scope', () => ({ resolveAgentScope }))
vi.mock('@/lib/ai/gate', () => ({ admitAiRun }))
vi.mock('@/lib/agent/trace', () => ({ agentTrace }))
vi.mock('@/lib/ai/router/spend', () => ({ addDailySpend, getDailySpend: () => 0 }))
vi.mock('@/lib/today/service', () => ({ buildTodayBrief: vi.fn() }))
vi.mock('@/db/briefing', () => ({ getNamedLeadById: vi.fn() }))
vi.mock('@/db/aiSummaries', () => ({ getLeadIntelligenceInputs: vi.fn() }))
vi.mock('@/db/agentConversation', () => ({
  findLatestLeadConversation: vi.fn(),
  listAgentConversationMessages: vi.fn(),
  AGENT_MESSAGE_LIMIT_DEFAULT: 30,
  AGENT_MESSAGE_LIMIT_MAX: 60,
}))
vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>()
  return { ...actual, generateText: generateTextSpy }
})

import { runAgentInvestigation } from '@/lib/agent/run'
import type { AgentScope } from '@/lib/agent/types'
import { Roles } from '@/types/roles'

const SCOPE: AgentScope = { agencyId: 7, userId: 3, role: Roles.ADMIN, gotPermIds: [], plan: 'pro', firstName: 'ב' }
const CFG = { role: 'primary', maxOutputTokens: 1_200, timeoutMs: 40_000, retryOnSameProvider: 0, providerMaxRetries: 0 }

/** The SDK result as it arrives when the payload never materialised. */
function resultWithThrowingOutput(finishReason: string) {
  return {
    finishReason,
    totalUsage: { inputTokens: 13_269, outputTokens: 1_367 },
    steps: [{ toolCalls: [{ toolName: 'get_today_state' }] }],
    get output(): never {
      throw Object.assign(new Error('No output generated.'), { name: 'AI_NoOutputGeneratedError' })
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  resolveAgentScope.mockResolvedValue(SCOPE)
  admitAiRun.mockResolvedValue({
    ok: true,
    cfg: CFG,
    effectiveRole: 'primary',
    chain: [{ provider: 'openai', modelId: 'gpt-5.6', model: { id: 'm' } }],
  })
})

describe('a run that generated no structured output', () => {
  it('returns a result instead of throwing', async () => {
    generateTextSpy.mockResolvedValue(resultWithThrowingOutput('length'))
    const result = await runAgentInvestigation({ question: 'מה הבעיה הכי גדולה שלי כרגע?' })
    expect(result.ok).toBe(false)
  })

  it('reports it as a refusal, not as a provider error', async () => {
    generateTextSpy.mockResolvedValue(resultWithThrowingOutput('length'))
    const result = await runAgentInvestigation({ question: 'שאלה' })
    expect(result).toMatchObject({ ok: false, reason: 'no_evidence', rejection: 'malformed' })
  })

  it('still charges for the tokens the run actually spent', async () => {
    generateTextSpy.mockResolvedValue(resultWithThrowingOutput('length'))
    const result = await runAgentInvestigation({ question: 'שאלה' })
    // The provider billed them whatever we do with the answer; a refused run
    // that reported zero cost would hide real spend.
    expect(result.costUsd).toBeGreaterThan(0)
    expect(addDailySpend).toHaveBeenCalled()
  })

  it('persists the failed run rather than losing it', async () => {
    generateTextSpy.mockResolvedValue(resultWithThrowingOutput('length'))
    const onPersist = vi.fn().mockResolvedValue(undefined)
    await runAgentInvestigation({ question: 'שאלה', onPersist })
    expect(onPersist).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'refused', stopReason: 'no_evidence', failureReason: 'malformed', answer: null }),
    )
  })

  it('traces the rejection so the cause is diagnosable', async () => {
    generateTextSpy.mockResolvedValue(resultWithThrowingOutput('length'))
    await runAgentInvestigation({ question: 'שאלה' })
    const stages = agentTrace.mock.calls.map((c) => c[0])
    expect(stages).toContain('ANSWER_REJECTED')
    // The finish reason that explains it is on the generation record.
    const generation = agentTrace.mock.calls.find((c) => c[0] === 'GENERATION_COMPLETE')
    expect(generation![2]).toMatchObject({ finishReason: 'length' })
  })

  it('invents no answer to fill the gap', async () => {
    generateTextSpy.mockResolvedValue(resultWithThrowingOutput('length'))
    const result = await runAgentInvestigation({ question: 'שאלה' })
    expect(result).not.toHaveProperty('answer')
  })

  it('leaves a normal answer completely unaffected', async () => {
    generateTextSpy.mockResolvedValue({
      finishReason: 'stop',
      totalUsage: { inputTokens: 10, outputTokens: 10 },
      steps: [],
      output: {
        headline: 'הכול תחת שליטה.',
        claims: [],
        unknown: null,
        businessState: null,
      },
    })
    const result = await runAgentInvestigation({ question: 'היי' })
    expect(result.ok).toBe(true)
  })
})
