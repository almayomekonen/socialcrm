/**
 * TWO-PHASE AUTONOMOUS INVESTIGATION.
 *
 * ai@6.0.176 cannot vary structured output per step: `PrepareStepResult` has no
 * `output`/`responseFormat`, and the loop reads `responseFormat` from the call-level
 * `output` closure (dist/index.mjs:4354). One call is schema-enforced for every step
 * or for none — and `text.format` plus `tool_choice: "required"` in one OpenAI
 * Responses turn is a contradiction the provider resolves in favour of the format.
 *
 * Three production runs measured steps 0 under one arrangement; the fourth, after the
 * conflict was removed, measured steps 1 / evidence 40 and then died `malformed`
 * because nothing enforced the answer shape any more.
 *
 * So: gather under `required` with no format, then answer under the format with no
 * tools. These tests pin both request shapes and the handoff between them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Roles } from '@/types/roles'
import type { AgentScope } from '@/lib/agent/types'

const generateTextSpy = vi.hoisted(() => vi.fn())
const admitAiRun = vi.hoisted(() => vi.fn())
vi.mock('ai', async (i) => ({ ...(await i<typeof import('ai')>()), generateText: generateTextSpy }))
vi.mock('@/lib/ai/gate', () => ({ admitAiRun, AGENT_TASK_KIND: 'agent.investigate' }))
vi.mock('@/lib/ai/router/spend', () => ({ addDailySpend: vi.fn(), getDailySpend: () => 0 }))
vi.mock('@/db/briefing', () => ({
  getLeadsByName: vi.fn(async () => [{ id: 42, name: 'דוד', status: 'contacted', nextFollowUpAt: null }]),
  getNamedLeadById: vi.fn(),
}))
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
const ANSWER = { headline: 'כותרת', claims: [{ claimClass: 'FACT', text: 'f', entityEvidence: ['42'] }], unknown: null }
const TOOL_MSGS = [
  { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'find_lead', input: { name: 'דוד' } }] },
  {
    role: 'tool',
    content: [{ type: 'tool-result', toolCallId: 'c1', toolName: 'find_lead', output: { matches: [{ leadId: 42 }] } }],
  },
]

/** Phase 1 executes a real tool; Phase 2 returns the structured answer. */
function twoPhaseModel(opts: { p1Throws?: boolean; p2Throws?: boolean; runTool?: boolean; p2Output?: unknown } = {}) {
  let call = 0
  return vi.fn(async (a: Record<string, never>) => {
    call++
    if (call === 1) {
      if (opts.p1Throws) throw new Error('phase1 provider down')
      if (opts.runTool !== false) {
        const tools = a.tools as unknown as Record<string, { execute: (i: unknown, o: unknown) => Promise<unknown> }>
        await tools.find_lead!.execute({ name: 'דוד' }, { toolCallId: 'c1', messages: [] })
      }
      return {
        text: 'phase 1 prose, discarded',
        totalUsage: { inputTokens: 500, outputTokens: 50 },
        finishReason: 'stop',
        response: { messages: TOOL_MSGS },
      }
    }
    if (opts.p2Throws) throw new Error('phase2 provider down')
    return {
      output: 'p2Output' in opts ? opts.p2Output : ANSWER,
      totalUsage: { inputTokens: 300, outputTokens: 40 },
      finishReason: 'stop',
      response: { messages: [] },
    }
  })
}

const call = (n: number) => generateTextSpy.mock.calls[n]![0] as Record<string, never>

beforeEach(() => {
  generateTextSpy.mockReset()
  admitAiRun.mockReset().mockResolvedValue({
    ok: true,
    effectiveRole: 'primary',
    cfg: { role: 'primary', maxOutputTokens: 1200, providerMaxRetries: 0 },
    chain: [{ provider: 'openai', modelId: 'gpt-5.6', model: { id: 'm' } }],
  })
})

const autonomous = () => runAgentInvestigation({ question: 'q', scope: SCOPE, requireToolEvidence: true, maxSteps: 4 })

describe('1 · Phase 1 wire contract — evidence', () => {
  it('sends tools, requires a tool first, and NO structured output', async () => {
    generateTextSpy.mockImplementation(twoPhaseModel())
    await autonomous()
    const p1 = call(0)
    expect(Object.keys(p1.tools as object).sort()).toEqual(['find_lead', 'get_conversation', 'get_lead', 'get_today_state'])
    // prepareStep is present and is what forces the first tool. Its required→auto
    // sequence is asserted in the next test, sampled DURING the run — sampling it
    // afterwards would read 'auto', because by then a tool has already executed.
    expect(p1.prepareStep, 'Phase 1 must send prepareStep').toBeTypeOf('function')
    expect(p1.output, 'Phase 1 must carry no structured output').toBeUndefined()
    expect(p1.stopWhen).toBeDefined()
  })

  it('frees the tool choice once a tool has executed', async () => {
    const seen: string[] = []
    generateTextSpy.mockImplementation(async (a: Record<string, never>) => {
      if (generateTextSpy.mock.calls.length === 1) {
        const ps = a.prepareStep as unknown as () => { toolChoice: string }
        seen.push(ps().toolChoice)
        const tools = a.tools as unknown as Record<string, { execute: (i: unknown, o: unknown) => Promise<unknown> }>
        await tools.find_lead!.execute({ name: 'דוד' }, { toolCallId: 'c1', messages: [] })
        seen.push(ps().toolChoice)
        return { text: 'x', totalUsage: {}, finishReason: 'stop', response: { messages: TOOL_MSGS } }
      }
      return { output: ANSWER, totalUsage: {}, finishReason: 'stop', response: { messages: [] } }
    })
    await autonomous()
    expect(seen).toEqual(['required', 'auto'])
  })
})

describe('2 · Phase 2 wire contract — answer', () => {
  it('carries Output.object with the strict schema, no tools, no forced choice', async () => {
    generateTextSpy.mockImplementation(twoPhaseModel())
    await autonomous()
    const p2 = call(1)
    expect(p2.output, 'Phase 2 must be schema-enforced').toBeDefined()
    const rf = await (p2.output as unknown as { responseFormat: Promise<{ type: string; schema: unknown }> }).responseFormat
    expect(rf.type).toBe('json')
    expect(rf.schema).toBeDefined()
    expect(p2.tools).toBeUndefined()
    expect(p2.toolChoice).toBeUndefined()
    expect(p2.prepareStep).toBeUndefined()
  })
})

describe('3 · evidence handoff', () => {
  it('Phase 2 receives the question plus Phase 1 tool messages', async () => {
    generateTextSpy.mockImplementation(twoPhaseModel())
    await autonomous()
    const msgs = call(1).messages as unknown as { role: string }[]
    expect(msgs[0]).toEqual({ role: 'user', content: 'q' })
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant', 'tool'])
    expect(call(1).prompt, 'messages replace prompt in Phase 2').toBeUndefined()
  })

  it('the shared collector makes Phase 1 evidence citable by the Phase 2 answer', async () => {
    generateTextSpy.mockImplementation(twoPhaseModel())
    const r = await autonomous()
    expect(r.ok).toBe(true)
    if (r.ok === false) throw new Error('unreachable')
    // The claim cites lead 42, collected by find_lead in Phase 1, and survives the validator.
    expect(r.answer.claims).toHaveLength(1)
    expect(r.evidence.some((e) => e.kind === 'lead' && e.refId === '42')).toBe(true)
    expect(r.steps).toBe(1)
  })
})

describe('4 · interactive regression', () => {
  it('remains ONE call, with tools and structured output', async () => {
    generateTextSpy.mockImplementation(async () => ({
      output: ANSWER,
      totalUsage: {},
      finishReason: 'stop',
      response: { messages: [] },
    }))
    await runAgentInvestigation({ question: 'q', scope: SCOPE })
    expect(generateTextSpy).toHaveBeenCalledTimes(1)
    const c = call(0)
    expect(c.output).toBeDefined()
    expect(c.tools).toBeDefined()
    expect(c.prepareStep).toBeUndefined()
    expect(c.prompt).toBe('q')
  })
})

describe('5 · refused telemetry survives the split', () => {
  it('a Phase 2 answer citing nothing still reports Phase 1 steps and evidence', async () => {
    generateTextSpy.mockImplementation(twoPhaseModel({ p2Output: { headline: 'h', claims: [], unknown: null } }))
    const r = await autonomous()
    expect(r.ok).toBe(false)
    if (r.ok === true) throw new Error('unreachable')
    expect(r.reason).toBe('no_evidence')
    expect(r.steps, 'Phase 1 tool count must survive').toBe(1)
    expect((r.evidence ?? []).length, 'Phase 1 evidence must survive').toBeGreaterThan(0)
    expect(r.rejection).toBeTruthy()
  })

  it('an unusable Phase 2 output fails safely as malformed', async () => {
    generateTextSpy.mockImplementation(twoPhaseModel({ p2Output: undefined }))
    const r = await autonomous()
    expect(r.ok).toBe(false)
    if (r.ok === true) throw new Error('unreachable')
    expect(r.rejection).toBe('malformed')
    expect(r.steps).toBe(1)
  })
})

describe('6 · budget is not doubled', () => {
  it('Phase 2 passes no tools, so it cannot consume the tool budget', async () => {
    generateTextSpy.mockImplementation(twoPhaseModel())
    const r = await autonomous()
    expect(call(1).tools).toBeUndefined()
    expect(r.ok).toBe(true)
    if (r.ok === false) throw new Error('unreachable')
    expect(r.steps, 'one tool executed, in Phase 1 only').toBe(1)
  })

  it('both phases share one maxSteps ceiling', async () => {
    generateTextSpy.mockImplementation(twoPhaseModel())
    await autonomous()
    expect(call(0).stopWhen).toBeDefined()
    expect(call(1).stopWhen).toBeUndefined()
  })

  it('cost sums BOTH phases', async () => {
    generateTextSpy.mockImplementation(twoPhaseModel())
    const r = await autonomous()
    // 800 input / 90 output across the two phases — a single-phase bill would be lower.
    expect(r.costUsd).toBeGreaterThan(0)
    const singlePhaseOnly = 300 * 5e-6 + 40 * 30e-6
    expect(r.costUsd).toBeGreaterThan(singlePhaseOnly)
  })
})

describe('7 · failure handling', () => {
  it('Phase 1 provider failure → error, no Phase 2 call', async () => {
    generateTextSpy.mockImplementation(twoPhaseModel({ p1Throws: true }))
    const r = await autonomous()
    expect(r.ok).toBe(false)
    if (r.ok === true) throw new Error('unreachable')
    expect(r.reason).toBe('error')
    expect(generateTextSpy).toHaveBeenCalledTimes(1)
  })

  it('Phase 1 with NO tool execution still proceeds, and steps is a measured 0', async () => {
    generateTextSpy.mockImplementation(twoPhaseModel({ runTool: false }))
    const r = await autonomous()
    expect(generateTextSpy).toHaveBeenCalledTimes(2)
    expect(r.ok).toBe(false)
    if (r.ok === true) throw new Error('unreachable')
    // The claim cites lead 42 but nothing collected it — an evidence refusal, not malformed.
    expect(r.steps).toBe(0)
    expect(r.rejection).toBe('no-supportable-claim')
  })

  it('Phase 2 provider failure → error, and Phase 1 telemetry survives', async () => {
    generateTextSpy.mockImplementation(twoPhaseModel({ p2Throws: true }))
    const r = await autonomous()
    expect(r.ok).toBe(false)
    if (r.ok === true) throw new Error('unreachable')
    expect(r.reason).toBe('error')
    expect(r.steps).toBe(1)
    expect((r.evidence ?? []).length).toBeGreaterThan(0)
  })
})
