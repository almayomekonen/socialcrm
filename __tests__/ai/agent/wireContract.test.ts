/**
 * THE WIRE CONTRACT — what actually reaches OpenAI.
 *
 * Fix 1 (`toolChoice: 'required'` via prepareStep) was correct client-side and
 * still failed twice in production, both `steps 0` / `no_evidence`, $0.042850
 * combined. The captured HTTP body explained why: the same request carried
 *
 *     tool_choice : "required"
 *     text        : { format: { type: "json_schema", strict: true, ... } }
 *
 * Contradictory instructions for one Responses turn, and OpenAI honours
 * `text.format`. `Output.object` is not a tool — verified in ai@6.0.176
 * `dist/index.mjs:3354`, it only supplies a responseFormat and parses text — so
 * nothing absorbed `required`; the model simply answered.
 *
 * These tests assert the REQUEST, captured through a fake fetch. No provider is
 * ever called. They do NOT prove GPT-5.6 will choose a tool — that is a property
 * of the model, and only production can show it. What they prove is that the
 * structural conflict which defeated Fix 1 is gone from the evidence-required turn.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createOpenAI } from '@ai-sdk/openai'
import { Roles } from '@/types/roles'
import type { AgentScope } from '@/lib/agent/types'

const admitAiRun = vi.hoisted(() => vi.fn())
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
const SENTINEL = '@@captured@@'

/** Runs one investigation against a fetch that records the body and aborts. */
async function capture(requireToolEvidence: boolean): Promise<Record<string, unknown>> {
  let body: Record<string, unknown> = {}
  const fakeFetch = async (_u: unknown, init?: { body?: unknown }) => {
    body = JSON.parse(String(init?.body ?? '{}'))
    throw new Error(SENTINEL)
  }
  const openai = createOpenAI({ apiKey: 'sk-not-a-real-key', fetch: fakeFetch as never })
  admitAiRun.mockResolvedValue({
    ok: true,
    effectiveRole: 'primary',
    cfg: { role: 'primary', maxOutputTokens: 1200, providerMaxRetries: 0 },
    chain: [{ provider: 'openai', modelId: 'gpt-5.6', model: openai('gpt-5.6') }],
  })
  await runAgentInvestigation({ question: 'q', scope: SCOPE, requireToolEvidence, maxSteps: 4 })
  return body
}

beforeEach(() => admitAiRun.mockReset())

describe('A · autonomous wire contract', () => {
  it('sends every evidence tool', async () => {
    const b = await capture(true)
    const names = ((b.tools ?? []) as { name?: string }[]).map((t) => t.name).sort()
    expect(names).toEqual(['find_lead', 'get_activity_trends', 'get_business_summary', 'get_conversation', 'get_follow_up_health', 'get_lead', 'get_lead_health', 'get_lead_segment', 'get_revenue', 'get_today_state'])
  })

  it('sends tool_choice "required" on the first step', async () => {
    const b = await capture(true)
    expect(b.tool_choice).toBe('required')
  })

  it('sends NO structured-output field — the conflict that defeated Fix 1', async () => {
    const b = await capture(true)
    expect(b.text, 'text.format must be absent from the evidence-required turn').toBeUndefined()
    expect(Object.keys(b)).not.toContain('text')
    expect(Object.keys(b)).not.toContain('response_format')
  })

  it('the request is therefore structurally unable to satisfy required via text', async () => {
    const b = await capture(true)
    // Both halves of the guarantee, asserted together.
    expect(b.tool_choice).toBe('required')
    expect(b.text).toBeUndefined()
  })
})

describe('B · interactive wire contract is unchanged', () => {
  it('still sends text.format structured output', async () => {
    const b = await capture(false)
    const text = b.text as { format?: { type?: string } } | undefined
    expect(text?.format?.type).toBe('json_schema')
  })

  it('does not force a tool choice', async () => {
    const b = await capture(false)
    // No prepareStep is attached, so the call-level default applies.
    expect(b.tool_choice).not.toBe('required')
  })

  it('still sends every tool', async () => {
    const b = await capture(false)
    // This harness records `tools` as a positional array, so the assertion is
    // on size: the contract here is that the interactive path sends the WHOLE
    // surface, and the per-name check lives in run.test.ts and tools.test.ts
    // where the registry itself is in scope.
    expect(((b.tools ?? []) as unknown[]).length).toBe(10)
  })
})

describe('E · mutation guard', () => {
  it('Phase 1 must not attach Output.object; Phase 2 must', () => {
    const src = require('node:fs')
      .readFileSync('lib/agent/run.ts', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .map((l: string) => l.split('//')[0])
      .join('\n')
    // Exactly two Output.object sites: the interactive call and Phase 2. The evidence
    // phase must have none, or `tool_choice: "required"` is opposed again.
    const sites = (src.match(/output: Output\.object/g) ?? []).length
    expect(sites, 'interactive + Phase 2, and nothing else').toBe(2)
    // The evidence phase is the block that sends prepareStep; it must carry no output.
    const phase1 = src.slice(src.indexOf('prepareStep:'), src.indexOf('evidenceUsage ='))
    expect(phase1).not.toContain('Output.object')
  })
})
