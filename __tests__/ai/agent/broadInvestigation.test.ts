/**
 * Today is a daily queue, not a measure of business health.
 *
 * THE DEFECT THIS GUARDS. `get_today_state` used to advertise itself as the
 * thing to "call first for any what-needs-attention / what-should-I-do
 * question" — which is the phrasing of a broad judgement question, so the model
 * called it and stopped. Evaluation caught it: asked "מה הבעיה הכי גדולה שלי?"
 * on a tenant with 8 queue items, 11 leads with no next step and 11 gone cold,
 * the answer came from the queue alone and never saw either structural problem.
 *
 * WHAT THESE TESTS CAN AND CANNOT PROVE. Tool selection is the model's decision,
 * so a unit test cannot assert which tool it picks without mocking the choice —
 * which would then be testing the mock. What they CAN pin is the contract the
 * decision is made from: that the daily tool no longer claims the broad ground,
 * that it names the structural tool to pair with, and that the prompt states the
 * policy and still permits a Today-only answer to a Today question. The
 * behavioural half is measured live, in the evaluation matrix.
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
import { AGENT_SYSTEM_PROMPT } from '@/lib/agent/prompt'
import type { AgentScope } from '@/lib/agent/types'
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
const EMPTY = { total: 0, sample: [] }

/** The tenant from the evaluation: a busy queue hiding a structural problem. */
function busyWithStructuralProblem() {
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
}

beforeEach(() => {
  vi.clearAllMocks()
  busyWithStructuralProblem()
  getUnreadInboxSummary.mockResolvedValue({ conversations: 2, unread: 4 })
  getLeadTotals.mockResolvedValue({ all: 19, open: 19 })
  getActivityWindow.mockResolvedValue({ newLeads: 8, statusChanges: 0, inboundMessages: 4, outboundMessages: 2, activeDays: 4 })
})

// ─── The description no longer claims the broad ground ──────────────────────

describe('get_today_state describes itself as a daily view', () => {
  const desc = () => (buildAgentTools(deps()).get_today_state as unknown as { description: string }).description

  it('no longer tells the model to call it first for "what should I do"', () => {
    // The exact sentence that produced the defect.
    expect(desc()).not.toMatch(/call this first for any/i)
  })

  it('says plainly that it is not a measure of business health', () => {
    expect(desc()).toMatch(/not a measure of business health/i)
  })

  it('warns that a non-empty queue is not proof of the biggest problems', () => {
    expect(desc()).toMatch(/does NOT mean these are the business/i)
  })

  it('names the structural tool to pair with for a broad question', () => {
    expect(desc()).toMatch(/get_lead_health/)
  })

  it('still owns the daily question, so simple queries stay cheap', () => {
    expect(desc()).toMatch(/what do I have today/i)
  })
})

describe('get_lead_health claims the broad ground', () => {
  const desc = () => (buildAgentTools(deps()).get_lead_health as unknown as { description: string }).description

  it('states it applies to broad judgement questions', () => {
    expect(desc()).toMatch(/broad judgement question/i)
  })

  it('says explicitly that a non-empty Today does not excuse skipping it', () => {
    expect(desc()).toMatch(/when get_today_state already returned items/i)
  })
})

// ─── The policy is in the instructions ──────────────────────────────────────

describe('the investigation policy is stated', () => {
  it('forbids answering a broad judgement question from Today alone', () => {
    expect(AGENT_SYSTEM_PROMPT).toMatch(/אסור לענות עליה מ-get_today_state לבד/)
  })

  it('says a full queue does not prove those are the biggest problems', () => {
    expect(AGENT_SYSTEM_PROMPT).toMatch(/תור לא ריק לא מוכיח/)
  })

  it('covers the role-framed variants the evaluation used', () => {
    for (const phrase of ['מה הבעיה הכי גדולה שלי', 'מה אני מפספס', 'תמצא לי הזדמנות', 'תניח שאתה מנהל את העסק שלי']) {
      expect(AGENT_SYSTEM_PROMPT, phrase).toContain(phrase)
    }
  })

  it('asks for the distinction to be stated when the two disagree', () => {
    expect(AGENT_SYSTEM_PROMPT).toMatch(/מה דחוף היום, ומה הבעיה הגדולה יותר מאחוריו/)
  })

  it('keeps a simple daily question on Today alone', () => {
    // Test 5: broadening every query would cost latency for nothing.
    // Two assertions rather than one dotAll regex: the `s` flag needs an ES2018
    // target, and this suite compiles under the repo's existing one.
    expect(AGENT_SYSTEM_PROMPT).toContain('"מה יש לי היום"')
    expect(AGENT_SYSTEM_PROMPT).toMatch(/נענית מ-get_today_state לבד/)
  })

  it('bounds the investigation rather than demanding every tool', () => {
    expect(AGENT_SYSTEM_PROMPT).toMatch(/עצור ברגע שיש לך מספיק/)
  })

  it('adds the trend tool only for questions about change', () => {
    expect(AGENT_SYSTEM_PROMPT).toMatch(/get_activity_trends רק אם השאלה נוגעת לשינוי/)
  })
})

// ─── The structural evidence is actually reachable ──────────────────────────

describe('the structural problem is visible once the tool is called', () => {
  it('Test 1 — a busy tenant still surfaces no_next_step and gone_cold', async () => {
    const d = deps()
    const tools = buildAgentTools(d)
    const today = await run(tools.get_today_state)
    const health = await run(tools.get_lead_health)

    // Today shows a full queue …
    expect(today.total).toBe(8)
    // … and says nothing about either structural problem.
    expect(JSON.stringify(today)).not.toContain('no_next_step')

    const cats = health.categories as Record<string, { total: number }>
    expect(cats.no_next_step!.total).toBe(11)
    expect(cats.gone_cold!.total).toBe(11)
    // Both are citable, so a recommendation can rest on them.
    expect(d.evidence.hasMetric('health.no_next_step')).toBe(true)
    expect(d.evidence.hasMetric('health.gone_cold')).toBe(true)
  })

  it('Test 2 — a busy tenant with healthy structure reports no structural problem', async () => {
    getLeadsWithoutNextStep.mockResolvedValue(EMPTY)
    getLeadsNotContactedRecently.mockResolvedValue(EMPTY)
    getOverdueFollowUps.mockResolvedValue(EMPTY)
    const health = await run(buildAgentTools(deps()).get_lead_health)
    const cats = health.categories as Record<string, { total: number }>
    // Nothing invented to justify having looked: the queue really is the issue.
    expect(cats.no_next_step!.total).toBe(0)
    expect(cats.gone_cold!.total).toBe(0)
    expect(cats.follow_up_overdue!.total).toBe(0)
  })

  it('Test 3 — a healthy tenant with an empty queue has nothing to escalate', async () => {
    buildTodayBrief.mockResolvedValue({
      greeting: 'ב', firstName: 'ב', items: [], total: 0, remaining: 0, handledToday: 0,
      volumeState: 'quiet', statusVerdict: 'ok', meetings: [],
    })
    for (const m of [getPromisedButWaiting, getFollowUpsDueToday, getOverdueFollowUps, getLeadsWithoutNextStep, getLeadsNotContactedRecently]) {
      m.mockResolvedValue(EMPTY)
    }
    const today = await run(buildAgentTools(deps()).get_today_state)
    const health = await run(buildAgentTools(deps()).get_lead_health)
    expect(today.total).toBe(0)
    const cats = health.categories as Record<string, { total: number }>
    for (const id of ['waiting_for_reply', 'follow_up_overdue', 'no_next_step', 'gone_cold']) {
      expect(cats[id]!.total, id).toBe(0)
    }
  })

  it('Test 4 — an acquisition decline is visible without inventing its cause', async () => {
    getActivityWindow
      .mockResolvedValueOnce({ newLeads: 0, statusChanges: 6, inboundMessages: 0, outboundMessages: 0, activeDays: 1 })
      .mockResolvedValueOnce({ newLeads: 6, statusChanges: 4, inboundMessages: 0, outboundMessages: 0, activeDays: 1 })
    const out = await run(buildAgentTools(deps()).get_activity_trends)
    expect((out.current as { newLeads: number }).newLeads).toBe(0)
    expect((out.previous as { newLeads: number }).newLeads).toBe(6)
    // The tool reports the drop and refuses to explain it — no channel, no cause.
    expect(Object.keys(out)).not.toContain('cause')
    expect(out.unavailable).toEqual(['revenue', 'conversion_rate'])
  })

  it('Test 5 — the daily question is still answerable from Today alone', async () => {
    const d = deps()
    const today = await run(buildAgentTools(d).get_today_state)
    expect(today.total).toBe(8)
    // One step, no structural read forced.
    expect(d.budget.stepsUsed()).toBe(1)
  })
})

// ─── Budget unaffected ──────────────────────────────────────────────────────

describe('pairing two tools stays inside the budget', () => {
  it('a broad investigation of Today plus lead health costs two steps of six', async () => {
    const d = deps()
    const tools = buildAgentTools(d)
    await run(tools.get_today_state)
    await run(tools.get_lead_health)
    expect(d.budget.stepsUsed()).toBe(2)
    expect(d.budget.reason()).toBeNull()
  })
})
