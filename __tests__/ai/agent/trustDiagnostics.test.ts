import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createEvidenceCollector } from '@/lib/agent/evidence'
import { validateAgentAnswer, validateAgentAnswerDetailed } from '@/lib/agent/validate'
import { buildAgentTools, TODAY_METRIC_IDS } from '@/lib/agent/tools'
import type { AgentAnswer, AgentScope } from '@/lib/agent/types'
import { Roles } from '@/types/roles'

const buildTodayBrief = vi.hoisted(() => vi.fn())
vi.mock('@/lib/today/service', () => ({ buildTodayBrief }))
vi.mock('@/db/briefing', () => ({ getNamedLeadById: vi.fn() }))
vi.mock('@/db/aiSummaries', () => ({ getLeadIntelligenceInputs: vi.fn() }))
vi.mock('@/db/agentConversation', () => ({
  findLatestLeadConversation: vi.fn(),
  listAgentConversationMessages: vi.fn(),
  AGENT_MESSAGE_LIMIT_DEFAULT: 30,
  AGENT_MESSAGE_LIMIT_MAX: 60,
}))

import { createBudget } from '@/lib/agent/budget'

/**
 * The metric-evidence contract, and the diagnostics that made its breach
 * invisible.
 *
 * Production investigation inv_mt7795vh_ptvevm completed generation cleanly,
 * collected 21 evidence items, and still returned no_evidence. The cause was a
 * contract gap, not a validator fault: get_today_state recorded metric evidence
 * under the ids `today.total` / `today.remaining` while its model-facing payload
 * exposed only the NUMBERS. The prompt asks the model to cite metric names it was
 * never shown, and `hasMetric` requires an exact match — so any count-shaped
 * answer lost every reference and was refused.
 *
 * It was undiagnosable because the rejection path discarded the diagnostics and
 * persisted hardcoded zeros. Both halves are pinned here.
 *
 * The boundary is NOT relaxed anywhere below: a raw number is still not a metric
 * id, and an unresolved reference is still dropped.
 */

const SCOPE: AgentScope = { agencyId: 7, userId: 3, role: Roles.ADMIN, gotPermIds: [], plan: 'pro', firstName: 'עלמה' }
const OPTS = { toolCallId: 't', messages: [] } as never
const run = (t: unknown, i: unknown) =>
  (t as { execute: (i: unknown, o: unknown) => Promise<Record<string, unknown>> }).execute(i, OPTS)

function deps() {
  return {
    scope: SCOPE,
    evidence: createEvidenceCollector(),
    budget: createBudget({ maxSteps: 6, deadlineMs: 60_000, now: () => 0 }),
    nowMs: 0,
  }
}

const BRIEF = {
  greeting: 'בוקר טוב',
  firstName: 'עלמה',
  items: [{ id: 15015, name: 'דנה', state: 'waiting_reply', reason: 'ממתין', targetSurface: 'inbox', phone: '050' }],
  total: 19,
  remaining: 19,
  handledToday: 0,
  volumeState: 'clear',
  statusVerdict: 'covered',
  meetings: [],
}

beforeEach(() => {
  buildTodayBrief.mockReset().mockResolvedValue(BRIEF)
})

// ── PHASE 2: the tool exposes what it records ────────────────────────────────

describe('get_today_state exposes every metric id it records as evidence', () => {
  it('returns a metrics map keyed by the exact evidence ids', async () => {
    const d = deps()
    const out = await run(buildAgentTools(d).get_today_state, {})
    expect(out.metrics).toEqual({ 'today.total': 19, 'today.remaining': 19 })
  })

  // REGRESSION: this is the production failure. Reverting to a payload that
  // exposes only numbers must fail here.
  it.each(['today.total', 'today.remaining'])('exposes %s in the model-facing payload', async (id) => {
    const out = await run(buildAgentTools(deps()).get_today_state, {})
    expect(JSON.stringify(out)).toContain(id)
  })

  it('every metric id recorded as evidence is present in the payload — the invariant', async () => {
    const d = deps()
    const out = await run(buildAgentTools(d).get_today_state, {})
    const exposed = Object.keys((out.metrics ?? {}) as Record<string, number>)
    expect(exposed.length).toBeGreaterThan(0)
    for (const id of exposed) expect(d.evidence.hasMetric(id)).toBe(true)
    for (const id of TODAY_METRIC_IDS) {
      expect(d.evidence.hasMetric(id)).toBe(true)
      expect(exposed).toContain(id)
    }
  })

  it('keeps the existing numeric fields — the metrics map is additive', async () => {
    const out = await run(buildAgentTools(deps()).get_today_state, {})
    expect(out.total).toBe(19)
    expect(out.remaining).toBe(19)
  })
})

// ── PHASE 4: the production investigation, reproduced structurally ───────────

describe('inv_mt7795vh_ptvevm — 21 evidence items, count-shaped question', () => {
  const LEADS = ['1527','1557','1551','1517','1552','1567','1555','1516','1575','1476','1513','1512','1511','1510','1506','1505','1504','1501','1499']
  const W = { from: '2026-08-24T12:15:45.917Z', to: '2026-08-24T12:15:45.917Z' }

  function production() {
    const e = createEvidenceCollector()
    e.add({ kind: 'metric', metric: 'today.total', window: W, n: 19 })
    e.add({ kind: 'metric', metric: 'today.remaining', window: W, n: 19 })
    for (const id of LEADS) e.add({ kind: 'lead', refId: id })
    return e
  }

  it('reproduces the collected ledger exactly — 21 items', () => {
    expect(production().size()).toBe(21)
  })

  it('ACCEPTS an OBSERVATION citing a metric id the payload now exposes', () => {
    const ans: AgentAnswer = {
      headline: '19 לידים ממתינים לתשובה.',
      claims: [{ claimClass: 'OBSERVATION', text: '19 לידים ממתינים.', metricEvidence: ['today.total'] }],
      unknown: null,
    }
    const out = validateAgentAnswer(ans, production())
    expect(out).not.toBeNull()
    expect(out!.claims).toHaveLength(1)
  })

  // The boundary is unchanged: a raw value is not an identifier.
  it('still REJECTS an OBSERVATION citing only a raw numeric value', () => {
    const ans: AgentAnswer = {
      headline: '19 לידים ממתינים.',
      claims: [{ claimClass: 'OBSERVATION', text: '19 לידים ממתינים.', metricEvidence: ['19'] }],
      unknown: null,
    }
    expect(validateAgentAnswer(ans, production())).toBeNull()
  })

  it('still REJECTS an unresolved metric id', () => {
    const ans: AgentAnswer = {
      headline: 'x',
      claims: [{ claimClass: 'OBSERVATION', text: 'x', metricEvidence: ['today.invented'] }],
      unknown: null,
    }
    expect(validateAgentAnswer(ans, production())).toBeNull()
  })

  it('accepts a FACT citing a real lead id from the same ledger', () => {
    const ans: AgentAnswer = {
      headline: 'דוד ממתין.',
      claims: [{ claimClass: 'FACT', text: 'דוד ממתין לתשובה.', entityEvidence: ['1527'] }],
      unknown: null,
    }
    expect(validateAgentAnswer(ans, production())?.claims).toHaveLength(1)
  })
})

// ── PHASE 1: diagnostics survive rejection ───────────────────────────────────

describe('rejection preserves prose-free diagnostics', () => {
  const c = () => {
    const e = createEvidenceCollector()
    e.add({ kind: 'lead', refId: '15015' })
    e.add({ kind: 'metric', metric: 'today.total', window: { from: 'a', to: 'b' }, n: 3 })
    return e
  }

  it('reports a non-zero droppedClaims when every claim was dropped', () => {
    const ans = {
      headline: 'סיכום',
      claims: [
        { claimClass: 'FACT', text: 'א', entityEvidence: ['99999'] },
        { claimClass: 'FACT', text: 'ב', entityEvidence: ['88888'] },
      ],
    } as unknown as AgentAnswer
    const v = validateAgentAnswerDetailed({ ...ans, unknown: null }, c())
    expect(v.answer).toBeNull()
    expect(v.rejection).toBe('no-supportable-claim')
    expect(v.counts.droppedClaims).toBe(2)
    expect(v.counts.byReason['no-valid-evidence']).toBe(2)
  })

  it('separates an unhedged inference in the reason counts', () => {
    const ans: AgentAnswer = {
      headline: 'x',
      claims: [{ claimClass: 'INFERENCE', text: 'דוד ממתין זמן רב.', evidence: ['15015'] }],
      unknown: null,
    }
    const v = validateAgentAnswerDetailed(ans, c())
    expect(v.answer).toBeNull()
    expect(v.counts.byReason['inference-not-hedged']).toBe(1)
    expect(v.counts.byReason['no-valid-evidence']).toBe(0)
  })

  it('names a whole-answer rejection rather than reporting a silent zero', () => {
    const banned: AgentAnswer = {
      headline: 'דנה היא ליד חם.',
      claims: [{ claimClass: 'FACT', text: 'דנה ממתינה.', entityEvidence: ['15015'] }],
      unknown: null,
    }
    expect(validateAgentAnswerDetailed(banned, c()).rejection).toBe('unsupported-claim')
    expect(validateAgentAnswerDetailed(null as unknown as AgentAnswer, c()).rejection).toBe('malformed')
  })

  it('counts stripped refs on an ACCEPTED answer', () => {
    const ans: AgentAnswer = {
      headline: 'x',
      claims: [{ claimClass: 'FACT', text: 'דנה', entityEvidence: ['15015', '99999'] }],
      unknown: null,
    }
    const v = validateAgentAnswerDetailed(ans, c())
    expect(v.answer).not.toBeNull()
    expect(v.counts.strippedRefs).toBe(1)
    expect(v.counts.droppedClaims).toBe(0)
  })

  it('carries no rejected prose in the counts — nothing persistable leaks', () => {
    const ans: AgentAnswer = {
      headline: 'SECRET-HEADLINE',
      claims: [{ claimClass: 'FACT', text: 'SECRET-CLAIM-TEXT', entityEvidence: ['99999'] }],
      unknown: null,
    }
    const v = validateAgentAnswerDetailed(ans, c())
    const dump = JSON.stringify({ rejection: v.rejection, counts: v.counts })
    expect(dump).not.toContain('SECRET-HEADLINE')
    expect(dump).not.toContain('SECRET-CLAIM-TEXT')
  })

  it('validateAgentAnswer keeps its exact existing contract', () => {
    const ok: AgentAnswer = {
      headline: 'x',
      claims: [{ claimClass: 'FACT', text: 'דנה', entityEvidence: ['15015'] }],
      unknown: null,
    }
    expect(validateAgentAnswer(ok, c())?.claims).toHaveLength(1)
    // A claimless answer is now a valid interactive reply (greeting / honest
    // unknown); the autonomous path keeps the stricter rule via requireClaim.
    expect(validateAgentAnswer({ ...ok, claims: [] }, c())).not.toBeNull()
  })
})
