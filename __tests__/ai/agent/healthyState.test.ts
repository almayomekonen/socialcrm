/**
 * Phase 3a — HEALTHY has to be earned.
 *
 * THE DEFECT THIS GUARDS. In the pinned 40-question evaluation, question A2 ran
 * against the tenant with real overdue follow-ups, asked about a trend, got a
 * comparison the tool itself marked unreliable, and said so correctly:
 * *"אין כרגע מספיק פעילות כדי לקבוע באופן אמין שהעסק נחלש."* It then carried
 * `businessState: HEALTHY`. The prose was right and the label was a verdict on a
 * business the investigation had never looked at.
 *
 * THE RULE. Pressure (URGENT / AT_RISK) needs a surviving evidenced claim —
 * unchanged. Calm (HEALTHY) needs that AND evidence from a tool that reads the
 * whole lead book, because "I did not find a problem" and "there is no problem"
 * are different statements and only the second one reassures honestly.
 *
 * OPPORTUNITY is deliberately untouched: it asserts neither pressure nor safety.
 */
import { describe, expect, it, vi } from 'vitest'
import { createEvidenceCollector } from '@/lib/agent/evidence'
import { validateAgentAnswer } from '@/lib/agent/validate'
import { WHOLE_BOOK_HEALTH_METRIC_PREFIXES, sawWholeBookEvidence } from '@/lib/agent/businessState'
import { AGENT_SYSTEM_PROMPT } from '@/lib/agent/prompt'
import type { AgentAnswer, BusinessState, Claim } from '@/lib/agent/types'
import type { EvidenceCollector } from '@/lib/agent/evidence'

// The drift guard at the bottom imports the real tool registry; these keep it
// from reaching a database. Every other test here is pure.
vi.mock('@/lib/today/service', () => ({ buildTodayBrief: vi.fn() }))
vi.mock('@/db/aiSummaries', () => ({ getLeadIntelligenceInputs: vi.fn() }))
vi.mock('@/db/agentConversation', () => ({
  findLatestLeadConversation: vi.fn(),
  listAgentConversationMessages: vi.fn(),
  AGENT_MESSAGE_LIMIT_DEFAULT: 30,
  AGENT_MESSAGE_LIMIT_MAX: 60,
}))
vi.mock('@/db/briefing', () => ({
  getNamedLeadById: vi.fn(), getFollowUpsDueToday: vi.fn(), getLeadsNotContactedRecently: vi.fn(),
  getNewLeadsThisWeek: vi.fn(), getOverdueTaskSummary: vi.fn(), getPromisedButWaiting: vi.fn(),
  getUnreadInboxSummary: vi.fn(),
}))
vi.mock('@/db/agentBusiness', () => ({
  getLeadTotals: vi.fn(), getOverdueFollowUps: vi.fn(), getLeadsWithoutNextStep: vi.fn(), getActivityWindow: vi.fn(),
}))

const W = { from: 'T0', to: 'T0' }

/** A collector holding exactly the metrics one tool would have produced. */
function collectorWith(metrics: string[], leadIds: string[] = []): EvidenceCollector {
  const e = createEvidenceCollector()
  for (const metric of metrics) e.add({ kind: 'metric', metric, window: W, n: 0 })
  for (const refId of leadIds) e.add({ kind: 'lead', refId })
  return e
}

const OBS = (metric: string): Claim => ({
  claimClass: 'OBSERVATION',
  text: 'אין כרגע פריטים פתוחים בקטגוריה הזו.',
  metricEvidence: [metric],
})
const FACT = (ref: string): Claim => ({ claimClass: 'FACT', text: 'הליד פתוח.', entityEvidence: [ref] })
const REC = (ref: string): Claim => ({ claimClass: 'RECOMMENDATION', text: 'הייתי ממשיך כרגיל.', evidence: [ref] })
const HEDGED = (ref: string): Claim => ({
  claimClass: 'INFERENCE',
  text: 'נראה שהמצב יציב.',
  evidence: [ref],
})

const answer = (claims: Claim[], businessState: BusinessState | null, unknown: string | null = null): AgentAnswer => ({
  headline: 'כותרת',
  claims,
  unknown,
  businessState,
})

const stateOf = (a: AgentAnswer, e: EvidenceCollector) => validateAgentAnswer(a, e)?.businessState

// ─── HEALTHY survives a whole-book look ─────────────────────────────────────

describe('HEALTHY survives when the whole book was actually read', () => {
  it('get_lead_health evidence supports it', () => {
    const e = collectorWith(['health.no_next_step', 'health.gone_cold'])
    expect(stateOf(answer([OBS('health.no_next_step')], 'HEALTHY'), e)).toBe('HEALTHY')
  })

  it('get_follow_up_health evidence supports it', () => {
    const e = collectorWith(['followup.overdue', 'followup.due_today'])
    expect(stateOf(answer([OBS('followup.overdue')], 'HEALTHY'), e)).toBe('HEALTHY')
  })

  it('get_business_summary evidence supports it', () => {
    const e = collectorWith(['business.open_leads', 'business.waiting_for_reply'])
    expect(stateOf(answer([OBS('business.open_leads')], 'HEALTHY'), e)).toBe('HEALTHY')
  })

  it('a whole-book read plus a narrow one is still a whole-book read', () => {
    const e = collectorWith(['today.total', 'health.gone_cold'])
    expect(stateOf(answer([OBS('today.total')], 'HEALTHY'), e)).toBe('HEALTHY')
  })
})

// ─── The A2 case, and its siblings ──────────────────────────────────────────

describe('a narrow investigation cannot pronounce the business healthy', () => {
  it('THE A2 CASE — an inconclusive trend is null, not HEALTHY', () => {
    // get_activity_trends alone: two windows of event counts, comparison
    // unreliable. It measures change, never condition.
    const e = collectorWith(['activity.new_leads', 'activity.active_days'])
    const v = validateAgentAnswer(
      answer(
        [OBS('activity.new_leads')],
        'HEALTHY',
        'אין מספיק פעילות להשוואה אמינה.',
      ),
      e,
    )
    expect(v).not.toBeNull()
    expect(v!.businessState).toBeNull()
    // The honest answer is preserved in full — only the verdict was withdrawn.
    expect(v!.claims).toHaveLength(1)
    expect(v!.unknown).toMatch(/אין מספיק פעילות/)
  })

  it('today’s queue alone is null — it cannot see stale or next-step-less leads', () => {
    const e = collectorWith(['today.total', 'today.remaining'])
    expect(stateOf(answer([OBS('today.total')], 'HEALTHY'), e)).toBeNull()
  })

  it('one named segment alone is null', () => {
    const e = collectorWith(['segment.new_this_week'])
    expect(stateOf(answer([OBS('segment.new_this_week')], 'HEALTHY'), e)).toBeNull()
  })

  it('one lead alone is null — the narrowest look there is', () => {
    const e = collectorWith(['lead.daysSinceLastInteraction'], ['161'])
    expect(stateOf(answer([FACT('lead:161')], 'HEALTHY'), e)).toBeNull()
  })

  it('no evidence at all is null', () => {
    expect(stateOf(answer([], 'HEALTHY'), createEvidenceCollector())).toBeNull()
  })
})

// ─── HEALTHY also needs something measured to survive ───────────────────────

describe('HEALTHY needs a surviving evidenced claim, not only a wide look', () => {
  const wide = () => collectorWith(['health.no_next_step'], ['161'])

  it('a whole-book read with no claims is still null', () => {
    expect(stateOf(answer([], 'HEALTHY'), wide())).toBeNull()
  })

  it('a recommendation alone cannot carry it — advice is not a finding', () => {
    expect(stateOf(answer([REC('lead:161')], 'HEALTHY'), wide())).toBeNull()
  })

  it('a hedged inference alone cannot carry it either', () => {
    expect(stateOf(answer([HEDGED('health.no_next_step')], 'HEALTHY'), wide())).toBeNull()
  })

  it('one OBSERVATION is enough', () => {
    expect(stateOf(answer([OBS('health.no_next_step'), REC('lead:161')], 'HEALTHY'), wide())).toBe('HEALTHY')
  })

  it('a claim dropped for bad evidence does not count toward it', () => {
    // The OBSERVATION cites a metric the collector never produced, so it is
    // destroyed — and cannot then be the finding HEALTHY rests on.
    const v = validateAgentAnswer(answer([OBS('health.invented'), REC('lead:161')], 'HEALTHY'), wide())
    expect(v!.claims.map((c) => c.claimClass)).toEqual(['RECOMMENDATION'])
    expect(v!.businessState).toBeNull()
  })
})

// ─── Nothing else moved ─────────────────────────────────────────────────────

describe('the other states are unchanged', () => {
  it('URGENT still needs only an evidenced finding, not a whole-book read', () => {
    const e = collectorWith(['today.total'])
    expect(stateOf(answer([OBS('today.total')], 'URGENT'), e)).toBe('URGENT')
  })

  it('AT_RISK likewise', () => {
    const e = collectorWith(['activity.new_leads'])
    expect(stateOf(answer([OBS('activity.new_leads')], 'AT_RISK'), e)).toBe('AT_RISK')
  })

  it('URGENT with nothing evidenced is still downgraded', () => {
    expect(stateOf(answer([], 'URGENT'), collectorWith(['health.gone_cold']))).toBeNull()
  })

  it('OPPORTUNITY still survives a thin answer and a narrow look', () => {
    expect(stateOf(answer([], 'OPPORTUNITY'), collectorWith(['activity.new_leads']))).toBe('OPPORTUNITY')
  })

  it('null stays null', () => {
    expect(stateOf(answer([OBS('health.gone_cold')], null), collectorWith(['health.gone_cold']))).toBeNull()
  })
})

// ─── The prefix list has not drifted from the tools ─────────────────────────

describe('the whole-book prefixes match the tools that actually read the book', () => {
  it('covers every metric get_lead_health, get_follow_up_health and get_business_summary emit', async () => {
    const { LEAD_HEALTH_METRIC_IDS, FOLLOW_UP_METRIC_IDS, BUSINESS_SUMMARY_METRIC_IDS } = await import('@/lib/agent/tools')
    for (const metric of [...LEAD_HEALTH_METRIC_IDS, ...FOLLOW_UP_METRIC_IDS, ...BUSINESS_SUMMARY_METRIC_IDS]) {
      expect(
        WHOLE_BOOK_HEALTH_METRIC_PREFIXES.some((p) => metric.startsWith(p)),
        `${metric} must count as a whole-book read`,
      ).toBe(true)
    }
  })

  it('covers NONE of the narrow tools’ metrics', async () => {
    const { TODAY_METRIC_IDS, ACTIVITY_METRIC_IDS, SEGMENT_METRIC_IDS } = await import('@/lib/agent/tools')
    for (const metric of [...TODAY_METRIC_IDS, ...ACTIVITY_METRIC_IDS, ...SEGMENT_METRIC_IDS]) {
      expect(
        WHOLE_BOOK_HEALTH_METRIC_PREFIXES.some((p) => metric.startsWith(p)),
        `${metric} must NOT count as a whole-book read`,
      ).toBe(false)
    }
  })

  it('sawWholeBookEvidence ignores entity evidence entirely', () => {
    // A hundred leads cited one by one is still not a survey of the book.
    const e = createEvidenceCollector()
    for (let i = 0; i < 100; i++) e.add({ kind: 'lead', refId: String(i) })
    expect(sawWholeBookEvidence(e)).toBe(false)
  })
})

// ─── The prompt asks for it, so the gate is a backstop and not a surprise ───

describe('the prompt states the contract', () => {
  it('says "not enough information" is null rather than HEALTHY', () => {
    expect(AGENT_SYSTEM_PROMPT).toMatch(/"לא מצאתי מספיק מידע" הוא null, לא HEALTHY/)
  })

  it('names the three tools that can establish HEALTHY', () => {
    for (const tool of ['get_lead_health', 'get_follow_up_health', 'get_business_summary']) {
      expect(AGENT_SYSTEM_PROMPT).toContain(tool)
    }
  })

  it('says an unreliable comparison is null', () => {
    expect(AGENT_SYSTEM_PROMPT).toMatch(/comparisonReliable=false\) היא null/)
  })

  it('says a narrow question cannot establish global health', () => {
    expect(AGENT_SYSTEM_PROMPT).toMatch(/לא יכולה לקבוע HEALTHY לעסק כולו/)
  })

  it('still permits a useful answer that carries no state at all', () => {
    expect(AGENT_SYSTEM_PROMPT).toMatch(/תשובה נכונה ומועילה עם null/)
  })
})
