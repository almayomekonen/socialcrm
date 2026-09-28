/**
 * Phase 3a — two independent reads should cost one wait, not two.
 *
 * THE MEASUREMENT THAT PROMPTED THIS. Pairing `get_today_state` with
 * `get_lead_health` on broad questions fixed the Phase 2.5.1 defect and moved
 * the 40-question evaluation from 13.0s average to 19.2s, p95 18.7s → 24.4s.
 * The trace could not explain it, because it recorded `steps` — TOOL CALLS — and
 * two calls emitted in one assistant turn cost one wait while two emitted in
 * consecutive turns cost two. Same `steps: 2`, very different latency.
 *
 * WHY NOT ORCHESTRATE IT IN APPLICATION CODE. Pre-fetching both tools before the
 * model call would guarantee one round trip and would also fetch them for the
 * simple daily question that needs only one — spending the budget Phase 2.5.1
 * was careful to leave alone. The tools are already parallel-safe (this file
 * proves it), the SDK already executes same-turn calls concurrently, so the
 * change is an instruction, not an architecture. If the instruction fails to
 * land, the fallback is orchestration; the evaluation is what decides.
 *
 * WHAT THIS FILE PROVES: that concurrency changes nothing the trust boundary
 * depends on — same evidence, same scope, same budget, same validation — and
 * that the instrumentation can tell a saved round trip from a hopeful prompt.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getFollowUpsDueToday = vi.hoisted(() => vi.fn())
const getLeadsNotContactedRecently = vi.hoisted(() => vi.fn())
const getNewLeadsThisWeek = vi.hoisted(() => vi.fn())
const getOverdueTaskSummary = vi.hoisted(() => vi.fn())
const getPromisedButWaiting = vi.hoisted(() => vi.fn())
const getUnreadInboxSummary = vi.hoisted(() => vi.fn())
const getLeadTotals = vi.hoisted(() => vi.fn())
const getOverdueFollowUps = vi.hoisted(() => vi.fn())
const getLeadsWithoutNextStep = vi.hoisted(() => vi.fn())
const getActivityWindow = vi.hoisted(() => vi.fn())
const buildTodayBrief = vi.hoisted(() => vi.fn())

vi.mock('@/lib/today/service', () => ({ buildTodayBrief }))
vi.mock('@/db/aiSummaries', () => ({ getLeadIntelligenceInputs: vi.fn() }))
vi.mock('@/db/agentConversation', () => ({
  findLatestLeadConversation: vi.fn(),
  listAgentConversationMessages: vi.fn(),
  AGENT_MESSAGE_LIMIT_DEFAULT: 30,
  AGENT_MESSAGE_LIMIT_MAX: 60,
}))
vi.mock('@/db/briefing', () => ({
  getNamedLeadById: vi.fn(),
  getFollowUpsDueToday,
  getLeadsNotContactedRecently,
  getNewLeadsThisWeek,
  getOverdueTaskSummary,
  getPromisedButWaiting,
  getUnreadInboxSummary,
}))
vi.mock('@/db/agentBusiness', () => ({ getLeadTotals, getOverdueFollowUps, getLeadsWithoutNextStep, getActivityWindow }))

import { buildAgentTools } from '@/lib/agent/tools'
import { createEvidenceCollector } from '@/lib/agent/evidence'
import { createBudget } from '@/lib/agent/budget'
import { createToolTimings, instrumentTools } from '@/lib/agent/instrument'
import { validateAgentAnswer } from '@/lib/agent/validate'
import { AGENT_SYSTEM_PROMPT } from '@/lib/agent/prompt'
import type { AgentAnswer, AgentScope, EvidenceRef } from '@/lib/agent/types'
import { Roles } from '@/types/roles'

const SCOPE: AgentScope = { agencyId: 7, userId: 3, role: Roles.ADMIN, gotPermIds: [], plan: 'pro', firstName: 'ב' }
const deps = () => ({
  scope: SCOPE,
  evidence: createEvidenceCollector(),
  budget: createBudget({ maxSteps: 6, deadlineMs: 60_000, now: () => 0 }),
  nowMs: 0,
})
const OPTS = { toolCallId: 't', messages: [] } as never
const run = (t: unknown, i: unknown = {}) =>
  (t as { execute: (a: unknown, b: unknown) => Promise<Record<string, never>> }).execute(i, OPTS)

const LIST = (total: number) => ({
  total,
  sample: Array.from({ length: Math.min(total, 3) }, (_, i) => ({ id: 300 + i, name: `ליד ${i}`, status: 'contacted' })),
})

/** A stable identity for one piece of evidence, order-independent. */
const fingerprint = (refs: EvidenceRef[]) =>
  refs
    .map((r) => (r.kind === 'metric' ? `metric:${r.metric}:${r.n}` : `${r.kind}:${r.refId}`))
    .sort()
    .join('|')

beforeEach(() => {
  vi.clearAllMocks()
  buildTodayBrief.mockResolvedValue({
    greeting: 'ב', firstName: 'ב', total: 8, remaining: 8, handledToday: 0,
    volumeState: 'normal', statusVerdict: 'ok', meetings: [],
    items: Array.from({ length: 8 }, (_, i) => ({ id: 400 + i, name: `תור ${i}`, state: 'waiting_reply', reason: 'ממתין', targetSurface: 'inbox' })),
  })
  getPromisedButWaiting.mockResolvedValue(LIST(4))
  getFollowUpsDueToday.mockResolvedValue(LIST(4))
  getOverdueFollowUps.mockResolvedValue(LIST(2))
  getLeadsWithoutNextStep.mockResolvedValue(LIST(11))
  getLeadsNotContactedRecently.mockResolvedValue(LIST(11))
  getNewLeadsThisWeek.mockResolvedValue(LIST(8))
  getOverdueTaskSummary.mockResolvedValue(LIST(2))
  getUnreadInboxSummary.mockResolvedValue({ conversations: 2, unread: 4 })
  getLeadTotals.mockResolvedValue({ all: 19, open: 19 })
  getActivityWindow.mockResolvedValue({ newLeads: 8, statusChanges: 0, inboundMessages: 4, outboundMessages: 2, activeDays: 4 })
})

// ─── The safety conditions, one test each ───────────────────────────────────

describe('the two broad-question tools are safe to run concurrently', () => {
  it('neither takes an argument, so neither can depend on the other’s output', () => {
    const tools = buildAgentTools(deps()) as Record<string, { inputSchema: unknown }>
    for (const name of ['get_today_state', 'get_lead_health']) {
      const shape = JSON.stringify(tools[name]!.inputSchema)
      // An object schema with no properties: nothing to pass, so nothing one
      // call could hand the other, and nothing the model could widen.
      expect(shape, `${name} must accept no input`).toContain('"shape":{}')
      for (const forbidden of ['leadId', 'days', 'segment', 'agencyId']) {
        expect(shape, `${name} must not accept ${forbidden}`).not.toContain(forbidden)
      }
    }
  })

  it('collects identical evidence in parallel and in sequence', async () => {
    const sequential = deps()
    const seqTools = buildAgentTools(sequential)
    await run(seqTools.get_today_state)
    await run(seqTools.get_lead_health)

    const parallel = deps()
    const parTools = buildAgentTools(parallel)
    await Promise.all([run(parTools.get_today_state), run(parTools.get_lead_health)])

    // The SET is what the validator resolves against; array order is not part of
    // the contract and is the only thing concurrency can change.
    expect(fingerprint(parallel.evidence.all())).toBe(fingerprint(sequential.evidence.all()))
    expect(parallel.evidence.size()).toBe(sequential.evidence.size())
  })

  it('spends the same budget either way', async () => {
    const sequential = deps()
    const seqTools = buildAgentTools(sequential)
    await run(seqTools.get_today_state)
    await run(seqTools.get_lead_health)

    const parallel = deps()
    const parTools = buildAgentTools(parallel)
    await Promise.all([run(parTools.get_today_state), run(parTools.get_lead_health)])

    expect(parallel.budget.stepsUsed()).toBe(2)
    expect(parallel.budget.stepsUsed()).toBe(sequential.budget.stepsUsed())
    expect(parallel.budget.reason()).toBeNull()
  })

  it('keeps the tenant scope identical — the agency travels in the closure', async () => {
    const d = deps()
    const tools = buildAgentTools(d)
    await Promise.all([run(tools.get_today_state), run(tools.get_lead_health)])
    for (const reader of [getPromisedButWaiting, getFollowUpsDueToday, getOverdueFollowUps, getLeadsWithoutNextStep]) {
      expect(reader).toHaveBeenCalledWith(expect.objectContaining({ agencyId: 7 }))
    }
  })

  it('leaves every claim reference resolvable', async () => {
    const d = deps()
    const tools = buildAgentTools(d)
    await Promise.all([run(tools.get_today_state), run(tools.get_lead_health)])
    // A lead from the queue and a metric from the structural read — the two
    // sources a broad answer cites together.
    expect(d.evidence.has('lead', '400')).toBe(true)
    expect(d.evidence.hasMetric('today.total')).toBe(true)
    expect(d.evidence.hasMetric('health.no_next_step')).toBe(true)
  })

  it('validates to exactly the same answer either way', async () => {
    const answer: AgentAnswer = {
      headline: 'כותרת',
      claims: [
        { claimClass: 'OBSERVATION', text: '11 לידים בלי צעד הבא.', metricEvidence: ['health.no_next_step'] },
        { claimClass: 'FACT', text: 'תור 0 ממתין.', entityEvidence: ['lead:400'] },
        { claimClass: 'RECOMMENDATION', text: 'הייתי מתחיל בהם.', evidence: ['lead:400'] },
      ],
      unknown: null,
      businessState: 'AT_RISK',
    }

    const sequential = deps()
    const seqTools = buildAgentTools(sequential)
    await run(seqTools.get_today_state)
    await run(seqTools.get_lead_health)

    const parallel = deps()
    const parTools = buildAgentTools(parallel)
    await Promise.all([run(parTools.get_today_state), run(parTools.get_lead_health)])

    const seq = validateAgentAnswer(answer, sequential.evidence)
    const par = validateAgentAnswer(answer, parallel.evidence)
    expect(par?.claims).toEqual(seq?.claims)
    expect(par?.businessState).toBe('AT_RISK')
    expect(par?.diagnostics.dropped).toEqual([])
  })

  it('still refuses a repeat call when the two arrive together', async () => {
    const d = deps()
    const tools = buildAgentTools(d)
    const [first, second] = await Promise.all([run(tools.get_lead_health), run(tools.get_lead_health)])
    // One is served, one is refused — the budget is consulted synchronously
    // inside each execute, so concurrency cannot produce two admissions.
    const refusals = [first, second].filter((r) => r.refused === true)
    expect(refusals).toHaveLength(1)
    expect(d.budget.stepsUsed()).toBe(1)
  })
})

// ─── The instrumentation can tell the two apart ─────────────────────────────

describe('instrumentTools measures the round trip without changing the tool', () => {
  it('preserves description and input schema exactly', () => {
    const plain = buildAgentTools(deps()) as Record<string, { description: string; inputSchema: unknown }>
    const wrapped = instrumentTools(plain, createToolTimings(), () => 0)
    for (const name of Object.keys(plain)) {
      expect(wrapped[name]!.description).toBe(plain[name]!.description)
      expect(wrapped[name]!.inputSchema).toBe(plain[name]!.inputSchema)
    }
  })

  it('records one span per executed call, with the tool’s name', async () => {
    const timings = createToolTimings()
    let clock = 0
    const tools = instrumentTools(buildAgentTools(deps()), timings, () => (clock += 5))
    await Promise.all([run(tools.get_today_state), run(tools.get_lead_health)])
    expect(timings.calls()).toBe(2)
    expect(timings.spans().map((s) => s.tool).sort()).toEqual(['get_lead_health', 'get_today_state'])
  })

  it('reports sum ABOVE wall when calls overlapped — the parallel signature', () => {
    const t = createToolTimings()
    t.record({ tool: 'get_today_state', startedAt: 100, endedAt: 900 })
    t.record({ tool: 'get_lead_health', startedAt: 110, endedAt: 950 })
    expect(t.sumMs()).toBe(800 + 840)
    expect(t.wallMs()).toBe(850)
    // 1640ms of work inside 850ms of waiting: one round trip, not two.
    expect(t.sumMs()).toBeGreaterThan(t.wallMs())
  })

  it('reports sum EQUAL to wall when calls were sequential', () => {
    const t = createToolTimings()
    t.record({ tool: 'get_today_state', startedAt: 0, endedAt: 400 })
    t.record({ tool: 'get_lead_health', startedAt: 400, endedAt: 900 })
    expect(t.sumMs()).toBe(900)
    expect(t.wallMs()).toBe(900)
  })

  it('reports zeroes rather than NaN when no tool ran', () => {
    const t = createToolTimings()
    expect(t.calls()).toBe(0)
    expect(t.sumMs()).toBe(0)
    expect(t.wallMs()).toBe(0)
  })

  it('times a failing tool too — a slow failure is the case worth seeing', async () => {
    const timings = createToolTimings()
    let clock = 0
    const boom = { description: 'x', inputSchema: {}, execute: async () => { throw new Error('nope') } }
    const wrapped = instrumentTools({ boom }, timings, () => (clock += 7))
    await expect(run(wrapped.boom)).rejects.toThrow('nope')
    expect(timings.calls()).toBe(1)
  })

  it('a throwing timing sink cannot fail a healthy tool call', async () => {
    const broken = { ...createToolTimings(), record: () => { throw new Error('observer') } }
    const tools = instrumentTools(buildAgentTools(deps()), broken, () => 0)
    await expect(run(tools.get_today_state)).resolves.toMatchObject({ total: 8 })
  })
})

// ─── The instruction that makes it happen ───────────────────────────────────

describe('the prompt asks for one turn, not two', () => {
  it('tells the model to pair the broad-question tools in the same call', () => {
    expect(AGENT_SYSTEM_PROMPT).toMatch(/שתי הקריאות באותה פנייה, בתור אחד, ולא אחת אחרי השנייה/)
  })

  it('says why — the rep is waiting', () => {
    expect(AGENT_SYSTEM_PROMPT).toMatch(/קריאה מקבילה חוסכת לנציג סבב המתנה שלם/)
  })

  it('states the general rule for any two independent tools', () => {
    expect(AGENT_SYSTEM_PROMPT).toMatch(/כשאתה צריך שני כלים שאינם תלויים זה בזה, קרא לשניהם באותה פנייה/)
  })

  it('does not turn that into permission to widen the investigation', () => {
    // The bound Phase 2.5.1 set stays exactly where it was.
    expect(AGENT_SYSTEM_PROMPT).toMatch(/עצור ברגע שיש לך מספיק/)
    expect(AGENT_SYSTEM_PROMPT).toMatch(/אל תקרא לכל כלי ה-BI/)
  })
})
