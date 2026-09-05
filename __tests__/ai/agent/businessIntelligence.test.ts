/**
 * Phase 2 — the three business-intelligence tools.
 *
 * These pin the things that would be invisible in an answer and expensive in
 * production: that the agency travels in the closure, that a true total is never
 * silently replaced by a sample length, that the tools refuse to invent the two
 * measures SocialCRM does not have (a lead score, a trend verdict on noise), and
 * that an empty business reads as empty rather than as an error.
 *
 * Runs under VITEST_NO_DB=1 — every reader is mocked.
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

vi.mock('@/lib/today/service', () => ({ buildTodayBrief: vi.fn() }))
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
vi.mock('@/db/agentBusiness', () => ({
  getLeadTotals,
  getOverdueFollowUps,
  getLeadsWithoutNextStep,
  getActivityWindow,
}))

import { buildAgentTools } from '@/lib/agent/tools'
import { createEvidenceCollector } from '@/lib/agent/evidence'
import { createBudget } from '@/lib/agent/budget'
import { validateAgentAnswer } from '@/lib/agent/validate'
import type { AgentAnswer, AgentScope, EvidenceRef } from '@/lib/agent/types'
import { Roles } from '@/types/roles'

const SCOPE: AgentScope = { agencyId: 7, userId: 3, role: Roles.ADMIN, gotPermIds: [], plan: 'pro', firstName: 'עלמה' }

function deps(scope: AgentScope = SCOPE) {
  return {
    scope,
    evidence: createEvidenceCollector(),
    budget: createBudget({ maxSteps: 6, deadlineMs: 60_000, now: () => 0 }),
    nowMs: 0,
  }
}

const OPTS = { toolCallId: 't1', messages: [] } as never
const run = (t: unknown, input: unknown = {}) =>
  (t as { execute: (i: unknown, o: unknown) => Promise<Record<string, never>> }).execute(input, OPTS)

/** `total` deliberately exceeds the sample, which is the truncation case. */
const LIST = (total: number, sampleSize = Math.min(total, 3)) => ({
  total,
  sample: Array.from({ length: sampleSize }, (_, i) => ({ id: 200 + i, name: `ליד ${i}`, status: 'contacted' })),
})
const EMPTY = { total: 0, sample: [] }
const WINDOW = (n: number) => ({
  newLeads: n, statusChanges: n, inboundMessages: n, outboundMessages: n, activeDays: Math.min(n, 7),
})

beforeEach(() => {
  vi.clearAllMocks()
  getFollowUpsDueToday.mockResolvedValue(LIST(4))
  getLeadsNotContactedRecently.mockResolvedValue(LIST(11))
  getNewLeadsThisWeek.mockResolvedValue(LIST(8))
  getOverdueTaskSummary.mockResolvedValue(LIST(2))
  getPromisedButWaiting.mockResolvedValue(LIST(2))
  getUnreadInboxSummary.mockResolvedValue({ conversations: 6, unread: 9 })
  getLeadTotals.mockResolvedValue({ all: 42, open: 30 })
  getOverdueFollowUps.mockResolvedValue(LIST(5))
  getLeadsWithoutNextStep.mockResolvedValue(LIST(9))
  getActivityWindow.mockResolvedValue(WINDOW(10))
})

// ─── Tenant isolation ───────────────────────────────────────────────────────

describe('tenant isolation — the agency travels in the closure', () => {
  const BI = ['get_lead_health', 'get_follow_up_health', 'get_activity_trends'] as const

  it('no BI tool accepts a scope field the model could set', () => {
    const tools = buildAgentTools(deps()) as Record<string, { inputSchema: unknown }>
    for (const name of BI) {
      const shape = JSON.stringify(tools[name]!.inputSchema)
      for (const forbidden of ['agencyId', 'userId', 'gotPermIds', 'plan', 'role']) {
        expect(shape, `${name} must not accept ${forbidden}`).not.toContain(forbidden)
      }
    }
  })

  it('every reader a BI tool touches receives the scope agency', async () => {
    const tools = buildAgentTools(deps())
    await run(tools.get_lead_health)
    await run(tools.get_follow_up_health)
    await run(tools.get_activity_trends)
    // Single-argument readers.
    for (const reader of [
      getPromisedButWaiting, getFollowUpsDueToday, getOverdueFollowUps,
      getLeadsWithoutNextStep, getLeadsNotContactedRecently, getNewLeadsThisWeek,
      getOverdueTaskSummary,
    ]) {
      expect(reader).toHaveBeenCalledWith(expect.objectContaining({ agencyId: 7 }))
    }
    // `getActivityWindow` takes the scope plus its window options; assert the
    // scope it received rather than the whole call shape.
    for (const call of getActivityWindow.mock.calls) {
      expect(call[0]).toMatchObject({ agencyId: 7 })
    }
    expect(getActivityWindow).toHaveBeenCalled()
  })

  it('a different scope reads a different agency, and never the first', async () => {
    await run(buildAgentTools(deps({ ...SCOPE, agencyId: 99 })).get_lead_health)
    expect(getOverdueFollowUps).toHaveBeenCalledWith(expect.objectContaining({ agencyId: 99 }))
    // The assertion that matters: agency 7's rows were never requested.
    expect(getOverdueFollowUps).not.toHaveBeenCalledWith(expect.objectContaining({ agencyId: 7 }))
  })

  it('a non-admin carries its permission set into every BI reader', async () => {
    const scoped = { ...SCOPE, role: Roles.AGNT, gotPermIds: [3, 4] }
    await run(buildAgentTools(deps(scoped)).get_follow_up_health)
    for (const reader of [getFollowUpsDueToday, getOverdueFollowUps, getLeadsWithoutNextStep]) {
      expect(reader).toHaveBeenCalledWith(expect.objectContaining({ agencyId: 7, gotPermIds: [3, 4] }))
    }
  })
})

// ─── get_lead_health ────────────────────────────────────────────────────────

describe('get_lead_health', () => {
  it('reports every category with a true total and a stated reason', async () => {
    const out = await run(buildAgentTools(deps()).get_lead_health)
    const cats = out.categories as Record<string, { total: number; reason: string; leads: unknown[] }>
    expect(Object.keys(cats).sort()).toEqual([
      'follow_up_due_today', 'follow_up_overdue', 'gone_cold', 'new_this_week', 'no_next_step', 'waiting_for_reply',
    ])
    for (const [id, c] of Object.entries(cats)) {
      expect(typeof c.total, id).toBe('number')
      expect(c.reason.length, id).toBeGreaterThan(10)
    }
  })

  it('states that there is NO lead score, in the payload the model reads', async () => {
    const out = await run(buildAgentTools(deps()).get_lead_health)
    expect(out.hasLeadScore).toBe(false)
    expect(String(out.scoringNote)).toMatch(/no lead score/i)
    // And it ships no number that could be mistaken for one.
    expect(JSON.stringify(out)).not.toMatch(/"(score|heat|probability)"/i)
  })

  it('makes every returned lead citable, and marks truncation', async () => {
    const d = deps()
    const out = await run(buildAgentTools(d).get_lead_health)
    const cold = (out.categories as Record<string, { total: number; truncated: boolean; leads: { leadId: number; evidenceRef: string }[] }>).gone_cold!
    expect(cold.total).toBe(11)
    for (const lead of cold.leads) {
      expect(d.evidence.has('lead', String(lead.leadId))).toBe(true)
      expect(lead.evidenceRef).toBe(`lead:${lead.leadId}`)
    }
    // The failure this guards: an answer citing the sample length would understate
    // the workload by exactly the cap.
    expect(cold.truncated).toBe(true)
    expect(d.evidence.all().find((r) => r.kind === 'metric' && r.metric === 'health.gone_cold')).toMatchObject({ n: 11 })
  })

  it('an empty business reads as empty, not as an error', async () => {
    for (const m of [getPromisedButWaiting, getFollowUpsDueToday, getOverdueFollowUps, getLeadsWithoutNextStep, getLeadsNotContactedRecently, getNewLeadsThisWeek]) {
      m.mockResolvedValue(EMPTY)
    }
    const out = await run(buildAgentTools(deps()).get_lead_health)
    const cats = out.categories as Record<string, { total: number; leads: unknown[] }>
    for (const c of Object.values(cats)) {
      expect(c.total).toBe(0)
      expect(c.leads).toEqual([])
    }
    expect(out.refused).toBeUndefined()
  })
})

// ─── get_follow_up_health ───────────────────────────────────────────────────

describe('get_follow_up_health', () => {
  it('separates the four ways the follow-up loop leaks', async () => {
    const out = await run(buildAgentTools(deps()).get_follow_up_health)
    const cats = out.categories as Record<string, { total: number }>
    expect(Object.keys(cats).sort()).toEqual(['awaiting_reply', 'due_today', 'no_next_step', 'overdue', 'overdue_tasks'])
    // Distinct states, not one blurred count: "never set" and "set and missed"
    // call for different actions.
    expect(cats.no_next_step!.total).toBe(9)
    expect(cats.overdue!.total).toBe(5)
  })

  it('records each category as a metric carrying its true size', async () => {
    const d = deps()
    await run(buildAgentTools(d).get_follow_up_health)
    const metric = d.evidence.all().find((r) => r.kind === 'metric' && r.metric === 'followup.overdue')
    expect(metric).toMatchObject({ n: 5 })
  })
})

// ─── get_activity_trends ────────────────────────────────────────────────────

describe('get_activity_trends', () => {
  it('returns a period AND its predecessor — one window is not a trend', async () => {
    const out = await run(buildAgentTools(deps()).get_activity_trends)
    expect(out.current).toBeDefined()
    expect(out.previous).toBeDefined()
    expect(getActivityWindow).toHaveBeenCalledTimes(2)
    // The second call reads the window before the first.
    expect(getActivityWindow.mock.calls[1]![1]).toMatchObject({ endingDaysAgo: 14 })
  })

  it('emits no verdict field — direction is the model\'s to argue', async () => {
    const out = await run(buildAgentTools(deps()).get_activity_trends)
    for (const forbidden of ['trend', 'direction', 'growth', 'decline', 'verdict']) {
      expect(Object.keys(out)).not.toContain(forbidden)
    }
  })

  it('flags a small sample as not comparable, and says why', async () => {
    getActivityWindow.mockResolvedValue(WINDOW(1)) // 4 events per window
    const out = await run(buildAgentTools(deps()).get_activity_trends)
    expect(out.comparisonReliable).toBe(false)
    expect(String(out.comparisonNote)).toMatch(/too little activity/i)
  })

  it('marks a healthy sample comparable', async () => {
    const out = await run(buildAgentTools(deps()).get_activity_trends)
    expect(out.comparisonReliable).toBe(true)
  })

  it('names revenue and conversion rate as unavailable rather than omitting them', async () => {
    const out = await run(buildAgentTools(deps()).get_activity_trends)
    expect(out.unavailable).toEqual(['revenue', 'conversion_rate'])
  })

  it('clamps the window rather than trusting the model', async () => {
    await run(buildAgentTools(deps()).get_activity_trends, { days: 9_999 })
    expect(getActivityWindow.mock.calls[0]![1]).toMatchObject({ days: 90 })
  })

  it('emits metrics only — a trend cannot ground a claim about a person', async () => {
    const d = deps()
    await run(buildAgentTools(d).get_activity_trends)
    expect(d.evidence.all().every((r: EvidenceRef) => r.kind === 'metric')).toBe(true)
  })
})

// ─── Fact vs interpretation vs recommendation ───────────────────────────────

describe('BI evidence supports facts, and recommendations stay recommendations', () => {
  async function collectorAfterLeadHealth() {
    const d = deps()
    await run(buildAgentTools(d).get_lead_health)
    return d.evidence
  }

  const answer = (claims: AgentAnswer['claims']): AgentAnswer => ({ headline: 'כותרת', claims, unknown: null })

  it('a count claim is supportable from the BI metric', async () => {
    const e = await collectorAfterLeadHealth()
    const v = validateAgentAnswer(
      answer([{ claimClass: 'OBSERVATION', text: '11 לידים התקררו.', metricEvidence: ['health.gone_cold'] }]),
      e,
    )
    expect(v?.claims).toHaveLength(1)
  })

  it('a recommendation grounded in a BI lead survives as a RECOMMENDATION', async () => {
    const e = await collectorAfterLeadHealth()
    const v = validateAgentAnswer(
      answer([
        { claimClass: 'OBSERVATION', text: '2 ממתינים למענה.', metricEvidence: ['health.waiting_for_reply'] },
        { claimClass: 'RECOMMENDATION', text: 'כדאי להתחיל בהם.', evidence: ['lead:200'] },
      ]),
      e,
    )
    expect(v?.claims.map((c) => c.claimClass)).toEqual(['OBSERVATION', 'RECOMMENDATION'])
  })

  it('an unmeasured business conclusion is NOT a fact', async () => {
    const e = await collectorAfterLeadHealth()
    // "You are losing customers because you respond too slowly" — no metric
    // measures it, so it cannot be a FACT however plausible it sounds.
    expect(
      validateAgentAnswer(
        answer([{ claimClass: 'FACT', text: 'אתה מאבד לקוחות בגלל זמן תגובה איטי.', entityEvidence: ['response_time'] }]),
        e,
      ),
    ).toBeNull()
  })

  it('the same conclusion IS acceptable as a hedged inference on real evidence', async () => {
    const e = await collectorAfterLeadHealth()
    const v = validateAgentAnswer(
      answer([
        {
          claimClass: 'INFERENCE',
          text: 'ייתכן שהבעיה היא בקצב המענה ולא בכמות הלידים.',
          evidence: ['health.waiting_for_reply'],
        },
      ]),
      e,
    )
    expect(v?.claims).toHaveLength(1)
  })

  it('an invented metric name is refused', async () => {
    const e = await collectorAfterLeadHealth()
    expect(
      validateAgentAnswer(
        answer([{ claimClass: 'OBSERVATION', text: 'שיעור ההמרה 18%.', metricEvidence: ['health.conversion_rate'] }]),
        e,
      ),
    ).toBeNull()
  })
})

// ─── Budget and routing regression ──────────────────────────────────────────

describe('the BI surface obeys the existing boundaries', () => {
  it('each BI tool consumes exactly one step, and repeats are refused', async () => {
    const d = deps()
    const tools = buildAgentTools(d)
    await run(tools.get_lead_health)
    await run(tools.get_follow_up_health)
    expect(d.budget.stepsUsed()).toBe(2)
    const repeat = await run(tools.get_lead_health)
    expect(repeat.refused).toBe(true)
    expect(d.budget.stepsUsed()).toBe(2)
  })

  it('a different trend window is a different call', async () => {
    const d = deps()
    const t = buildAgentTools(d).get_activity_trends
    await run(t, { days: 7 })
    const second = await run(t, { days: 30 })
    expect(second.refused).toBeUndefined()
    expect(d.budget.stepsUsed()).toBe(2)
  })

  it('the prompt routes BI questions without a classifier call', async () => {
    const { AGENT_SYSTEM_PROMPT } = await import('@/lib/agent/prompt')
    expect(AGENT_SYSTEM_PROMPT).toContain('get_lead_health')
    expect(AGENT_SYSTEM_PROMPT).toContain('get_follow_up_health')
    expect(AGENT_SYSTEM_PROMPT).toContain('get_activity_trends')
    // And it tells the model not to call all of them for every question.
    expect(AGENT_SYSTEM_PROMPT).toMatch(/אל תקרא לכל כלי ה-BI/)
  })

  it('the prompt forbids inventing a lead score or a trend verdict on noise', async () => {
    const { AGENT_SYSTEM_PROMPT } = await import('@/lib/agent/prompt')
    expect(AGENT_SYSTEM_PROMPT).toMatch(/אין ב-SocialCRM ציון ליד/)
    expect(AGENT_SYSTEM_PROMPT).toMatch(/comparisonReliable=false/)
  })
})
