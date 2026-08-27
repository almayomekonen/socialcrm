/**
 * The REQUEST CONTRACT for autonomous evidence-gathering.
 *
 * `toolChoice` defaults to `auto`, so the model may answer without calling a tool.
 * Production did exactly that: `inv_mtakjigp_tviv8y` (job 23985, lead 1516) returned
 * a schema-valid answer with ZERO tool calls, against a lead whose 30 messages were
 * one tool call away. The validator destroyed it as `no_evidence` — correctly, and
 * only after the tokens were paid for.
 *
 * WHAT THESE TESTS PROVE, AND WHAT THEY DO NOT.
 *
 * They prove the REQUEST we send: that the autonomous path asks the provider for a
 * tool call on the first step and frees it afterwards, and that the interactive path
 * is unchanged. They deliberately do NOT claim that GPT-5.6 will therefore choose a
 * tool — no unit test can establish that, because it is a property of the model, not
 * of our code. Production verification is the durable `ai_investigations.steps`
 * column: `steps > 0` on the next natural investigation is the real evidence.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Roles } from '@/types/roles'
import type { AgentScope } from '@/lib/agent/types'

const generateTextSpy = vi.hoisted(() => vi.fn())
const admitAiRun = vi.hoisted(() => vi.fn())

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>()
  return { ...actual, generateText: generateTextSpy }
})
vi.mock('@/lib/ai/gate', () => ({ admitAiRun, AGENT_TASK_KIND: 'agent.investigate' }))
vi.mock('@/lib/ai/router/spend', () => ({ addDailySpend: vi.fn(), getDailySpend: () => 0 }))
vi.mock('@/db/briefing', () => ({ getLeadsByName: vi.fn(), getNamedLeadById: vi.fn() }))
vi.mock('@/db/aiSummaries', () => ({ getLeadIntelligenceInputs: vi.fn() }))
vi.mock('@/lib/today/service', () => ({ buildTodayBrief: vi.fn() }))
vi.mock('@/db/agentConversation', () => ({
  findLatestLeadConversation: vi.fn(),
  listAgentConversationMessages: vi.fn(),
  AGENT_MESSAGE_LIMIT_DEFAULT: 30,
  AGENT_MESSAGE_LIMIT_MAX: 60,
}))

import { runAgentInvestigation } from '@/lib/agent/run'

const SCOPE: AgentScope = { agencyId: 103, userId: 332, role: Roles.ADMIN, gotPermIds: [], plan: 'pro', firstName: 'ע' }

/** A model that answers immediately — the exact production shape. */
const answersWithNoTools = () =>
  vi.fn(async () => ({
    output: { headline: 'h', claims: [], unknown: null },
    totalUsage: { inputTokens: 1681, outputTokens: 114 },
    finishReason: 'stop',
  }))

const args = () => generateTextSpy.mock.calls[0]![0] as Record<string, never>

beforeEach(() => {
  generateTextSpy.mockReset().mockImplementation(answersWithNoTools())
  admitAiRun.mockReset().mockResolvedValue({
    ok: true,
    effectiveRole: 'primary',
    cfg: { role: 'primary', maxOutputTokens: 1200, providerMaxRetries: 0 },
    chain: [{ provider: 'openai', modelId: 'gpt-5.6', model: { id: 'm' } }],
  })
})

describe('autonomous path · first step requires a tool', () => {
  it('sends prepareStep, and it asks for a tool while no tool has executed', async () => {
    await runAgentInvestigation({ question: 'q', scope: SCOPE, requireToolEvidence: true, maxSteps: 4 })

    const prepareStep = args().prepareStep as unknown as () => { toolChoice: string }
    expect(prepareStep, 'the autonomous path must send prepareStep').toBeTypeOf('function')
    // budget.stepsUsed() === 0 → nothing has executed yet.
    expect(prepareStep().toolChoice).toBe('required')
  })

  it('does NOT set a blanket call-level toolChoice — that would block the final answer', async () => {
    await runAgentInvestigation({ question: 'q', scope: SCOPE, requireToolEvidence: true })
    expect(args().toolChoice).toBeUndefined()
  })

  it('frees the choice to auto once a tool has actually executed, and steps counts it', async () => {
    // A real match, so find_lead records real evidence the answer can cite.
    const { getLeadsByName } = await import('@/db/briefing')
    vi.mocked(getLeadsByName).mockResolvedValue([{ id: 42, name: 'דוד', status: 'contacted', nextFollowUpAt: null }] as never)

    const seen: string[] = []
    generateTextSpy.mockImplementation(async (a: Record<string, never>) => {
      // PHASE-AWARE: only the evidence phase carries tools. Phase 2 has none, so it
      // must not re-run the tool — that would double the step count.
      if (generateTextSpy.mock.calls.length > 1) {
        return {
          output: { headline: 'h', claims: [{ claimClass: 'FACT', text: 'f', entityEvidence: ['42'] }], unknown: null },
          totalUsage: { inputTokens: 10, outputTokens: 5 },
          finishReason: 'stop',
          response: { messages: [] },
        }
      }
      const tools = a.tools as unknown as Record<string, { execute: (i: unknown, o: unknown) => Promise<unknown> }>
      const prepareStep = a.prepareStep as unknown as () => { toolChoice: string }

      seen.push(prepareStep().toolChoice) // before any tool ran
      // find_lead refuses a blank query BEFORE consuming budget, so use a real one.
      await tools.find_lead!.execute({ name: 'דוד' }, { toolCallId: 't', messages: [] })
      seen.push(prepareStep().toolChoice) // after one tool executed

      // Phase 1 returns tool messages; Phase 2 returns the schema-enforced answer.
      // Both arrive through this one spy, so it answers for whichever phase is asking.
      return {
        text: 'phase 1 prose, discarded',
        output: { headline: 'h', claims: [{ claimClass: 'FACT', text: 'f', entityEvidence: ['42'] }], unknown: null },
        totalUsage: { inputTokens: 10, outputTokens: 5 },
        finishReason: 'stop',
        response: { messages: [] },
      }
    })

    const r = await runAgentInvestigation({ question: 'q', scope: SCOPE, requireToolEvidence: true })

    // The whole contract, in one assertion: required first, auto afterwards.
    expect(seen).toEqual(['required', 'auto'])
    // And `steps` still means EXECUTED tools — budget.stepsUsed(), not round-trips.
    expect(r.ok).toBe(true)
    expect((r as { steps: number }).steps).toBe(1)
  })
})

describe('interactive path is unchanged', () => {
  it('omits prepareStep entirely when requireToolEvidence is not set', async () => {
    await runAgentInvestigation({ question: 'q', scope: SCOPE })
    expect(args().prepareStep).toBeUndefined()
    expect(args().toolChoice).toBeUndefined()
  })

  it('explicit false is also treated as interactive', async () => {
    await runAgentInvestigation({ question: 'q', scope: SCOPE, requireToolEvidence: false })
    expect(args().prepareStep).toBeUndefined()
  })
})

describe('nothing else about the request moved', () => {
  it('all four tools remain registered, with schemas, on both paths', async () => {
    for (const requireToolEvidence of [true, false]) {
      generateTextSpy.mockClear()
      await runAgentInvestigation({ question: 'q', scope: SCOPE, requireToolEvidence })
      const tools = args().tools as unknown as Record<string, { inputSchema?: unknown }>
      expect(Object.keys(tools).sort()).toEqual(['find_lead', 'get_conversation', 'get_lead', 'get_today_state'])
      for (const [name, t] of Object.entries(tools)) {
        expect(t.inputSchema, `${name} must carry a schema`).toBeDefined()
      }
    }
  })

  it('maxSteps and the system prompt are untouched on both paths', async () => {
    await runAgentInvestigation({ question: 'q', scope: SCOPE, requireToolEvidence: true, maxSteps: 4 })
    expect(args().stopWhen).toBeDefined()
    expect(args().system).toBeTypeOf('string')
  })

  /**
   * The structural fix: `Output.object` becomes `text.format` on the OpenAI
   * Responses API, and sending it alongside `tool_choice: "required"` is what let
   * the model answer instead of calling a tool. It must be absent from the
   * evidence-required turn and present everywhere else.
   */
  /**
   * Structured output moved to PHASE 2. `args()` reads the FIRST call, which for an
   * autonomous run is the evidence phase — it must stay format-free so
   * `tool_choice: "required"` is unopposed. Phase 2's own contract is asserted in
   * twoPhase.test.ts.
   */
  it('Phase 1 omits structured output; interactive keeps it in its single call', async () => {
    await runAgentInvestigation({ question: 'q', scope: SCOPE, requireToolEvidence: true })
    expect(args().output, 'the evidence phase must not carry Output.object').toBeUndefined()

    generateTextSpy.mockClear()
    await runAgentInvestigation({ question: 'q', scope: SCOPE })
    expect(args().output, 'interactive must keep Output.object').toBeDefined()
  })
})

describe('the autonomous caller actually asks for it', () => {
  it('investigationAdmission sets requireToolEvidence', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('lib/ai/integration/investigationAdmission.ts', 'utf8')
    expect(src).toContain('requireToolEvidence: true')
  })
})
