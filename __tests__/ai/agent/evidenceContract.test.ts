import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createEvidenceCollector, type EvidenceCollector } from '@/lib/agent/evidence'
import { createBudget } from '@/lib/agent/budget'
import { validateAgentAnswer } from '@/lib/agent/validate'
import type { AgentAnswer, AgentScope } from '@/lib/agent/types'
import { Roles } from '@/types/roles'

const buildTodayBrief = vi.hoisted(() => vi.fn())
const getNamedLeadById = vi.hoisted(() => vi.fn())
const getLeadsByName = vi.hoisted(() => vi.fn())
const getLeadIntelligenceInputs = vi.hoisted(() => vi.fn())
const findLatestLeadConversation = vi.hoisted(() => vi.fn())
const listAgentConversationMessages = vi.hoisted(() => vi.fn())

vi.mock('@/lib/today/service', () => ({ buildTodayBrief }))
vi.mock('@/db/briefing', () => ({ getNamedLeadById, getLeadsByName }))
vi.mock('@/db/aiSummaries', () => ({ getLeadIntelligenceInputs }))
vi.mock('@/db/agentConversation', () => ({
  findLatestLeadConversation,
  listAgentConversationMessages,
  AGENT_MESSAGE_LIMIT_DEFAULT: 30,
  AGENT_MESSAGE_LIMIT_MAX: 60,
}))

import { buildAgentTools } from '@/lib/agent/tools'

/**
 * THE EVIDENCE CONTRACT, as one invariant across every tool.
 *
 *   Every identifier a tool records as evidence must appear in the payload that
 *   tool returns to the model.
 *
 * Break it and the Agent completes an investigation, collects evidence, and is
 * then refused — because it is asked to cite identifiers it was never shown.
 * That failure has now happened three times in production, in three tools:
 *
 *   · get_today_state recorded `today.total` / `today.remaining` and showed only
 *     the numbers (fixed).
 *   · get_lead records seven measurements' worth of facts but emitted NO metric
 *     evidence, so "12 days without contact" — an OBSERVATION by the prompt's own
 *     definition — had nothing citable. inv_mt8me5sf_99y5es: 2 steps, Sali found,
 *     3 claims, all 3 dropped.
 *   · get_conversation records message evidence keyed by `m.id` and showed only
 *     `sequence`. inv_mt8mev3v_x24g97: 3 steps, 19 messages read, all 3 dropped.
 *
 * The helper below asserts the invariant generically, so a fourth occurrence is
 * caught by construction rather than by another forensic investigation.
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

/**
 * The reusable invariant: every metric id and every entity refId in the ledger
 * must be findable somewhere in the serialised payload the model received.
 */
function assertEveryEvidenceIdIsExposed(evidence: EvidenceCollector, payload: unknown) {
  const dump = JSON.stringify(payload)
  const refs = evidence.all()
  expect(refs.length).toBeGreaterThan(0)
  for (const ref of refs) {
    const id = ref.kind === 'metric' ? ref.metric : ref.refId
    expect(dump, `evidence id "${id}" (${ref.kind}) is not exposed in the tool payload`).toContain(id)
  }
}

const LEAD = { id: 1527, name: 'Sali', status: 'interested', nextFollowUpAt: null }
const INPUTS = {
  status: 'interested',
  leadSource: 'facebook',
  handlerName: 'עלמה',
  daysSinceLastInteraction: 12,
  daysInCurrentStatus: 30,
  daysSinceLastTask: 4,
  overdueTaskCount: 2,
  taskCompletionRate: 0.75,
  lastOutcomeType: null,
  recentTasks: [{ title: 'להתקשר', status: 'open', daysOld: 3 }],
  detailsExcerpt: 'הערות',
  phone: '050-0000000',
  email: 'sali@example.com',
  gender: 'f',
}

beforeEach(() => {
  buildTodayBrief.mockReset().mockResolvedValue({
    greeting: '',
    firstName: '',
    items: [{ id: 1527, name: 'Sali', state: 'x', reason: 'y', targetSurface: 'inbox' }],
    total: 19,
    remaining: 19,
    handledToday: 0,
    volumeState: 'clear',
    statusVerdict: 'covered',
    meetings: [],
  })
  getNamedLeadById.mockReset().mockResolvedValue(LEAD)
  getLeadsByName.mockReset().mockResolvedValue([LEAD])
  getLeadIntelligenceInputs.mockReset().mockResolvedValue({ inputs: INPUTS })
  findLatestLeadConversation.mockReset().mockResolvedValue({ conversationId: 55, messageCount: 40 })
  listAgentConversationMessages.mockReset().mockResolvedValue([
    { id: 777, sequence: 1, direction: 'inbound', text: 'שלום', timestamp: '2026-08-01T10:00:00.000Z' },
    { id: 784, sequence: 2, direction: 'outbound', text: 'היי', timestamp: '2026-08-01T10:05:00.000Z' },
  ])
})

// ── The invariant, across every tool ─────────────────────────────────────────

describe('every tool exposes every evidence id it records', () => {
  it.each([
    ['get_today_state', {}],
    ['find_lead', { name: 'Sali' }],
    ['get_lead', { leadId: 1527 }],
    ['get_conversation', { leadId: 1527 }],
  ])('%s', async (name, input) => {
    const d = deps()
    const payload = await run((buildAgentTools(d) as Record<string, unknown>)[name], input)
    assertEveryEvidenceIdIsExposed(d.evidence, payload)
  })
})

// ── get_lead ─────────────────────────────────────────────────────────────────

describe('get_lead metric contract', () => {
  it('exposes a metrics map whose keys are the recorded metric ids', async () => {
    const d = deps()
    const out = await run(buildAgentTools(d).get_lead, { leadId: 1527 })
    expect(out.metrics).toEqual({
      'lead.daysSinceLastInteraction': 12,
      'lead.daysInCurrentStatus': 30,
      'lead.daysSinceLastTask': 4,
      'lead.overdueTaskCount': 2,
      'lead.taskCompletionRate': 0.75,
    })
    for (const id of Object.keys(out.metrics as object)) expect(d.evidence.hasMetric(id)).toBe(true)
  })

  it('metric values match the values the payload already returned', async () => {
    const out = await run(buildAgentTools(deps()).get_lead, { leadId: 1527 })
    const m = out.metrics as Record<string, number>
    expect(m['lead.daysSinceLastInteraction']).toBe(out.daysSinceLastInteraction)
    expect(m['lead.overdueTaskCount']).toBe(out.overdueTaskCount)
    expect(m['lead.taskCompletionRate']).toBe(out.taskCompletionRate)
  })

  it('omits metrics whose value is unavailable — never invents a zero', async () => {
    getLeadIntelligenceInputs.mockResolvedValue({
      inputs: { ...INPUTS, daysSinceLastInteraction: null, daysInCurrentStatus: null, taskCompletionRate: null },
    })
    const d = deps()
    const out = await run(buildAgentTools(d).get_lead, { leadId: 1527 })
    const keys = Object.keys(out.metrics as object)
    expect(keys).not.toContain('lead.daysSinceLastInteraction')
    expect(keys).not.toContain('lead.taskCompletionRate')
    expect(keys).toContain('lead.overdueTaskCount')
    expect(d.evidence.hasMetric('lead.daysSinceLastInteraction')).toBe(false)
  })

  it('binds every metric to the lead it was measured on', async () => {
    // Without this binding a metric is subject-less: a claim resting on it has no
    // provenance to walk and the gate rejects at the provenance seam — the exact
    // production failure of investigation 7 (lead 1696).
    const d = deps()
    await run(buildAgentTools(d).get_lead, { leadId: 1527 })
    const metrics = d.evidence.all().filter((e) => e.kind === 'metric')
    expect(metrics.length).toBeGreaterThan(0)
    for (const m of metrics) expect(m.measuredOn).toEqual({ kind: 'lead', refId: '1527' })
  })

  it('get_today_state metrics are portfolio-wide and borrow NO subject', async () => {
    // A today metric is measured over the whole queue, not over one lead. Giving
    // it a measuredOn would let a portfolio number masquerade as evidence about
    // whichever lead happened to be under investigation.
    const d = deps()
    await run(buildAgentTools(d).get_today_state, {})
    const metrics = d.evidence.all().filter((e) => e.kind === 'metric')
    expect(metrics.length).toBeGreaterThan(0)
    for (const m of metrics) expect(m.measuredOn).toBeUndefined()
  })

  it('still records the lead evidence and the existing payload fields', async () => {
    const d = deps()
    const out = await run(buildAgentTools(d).get_lead, { leadId: 1527 })
    expect(d.evidence.has('lead', '1527')).toBe(true)
    expect(out.found).toBe(true)
    expect(out.leadId).toBe(1527)
    expect(out.name).toBe('Sali')
    expect(out.status).toBe('interested')
    expect(out.recentTasks).toEqual([{ title: 'להתקשר', status: 'open', daysOld: 3 }])
  })

  it('leaks no PII', async () => {
    const out = await run(buildAgentTools(deps()).get_lead, { leadId: 1527 })
    const dump = JSON.stringify(out)
    for (const secret of ['050-0000000', 'sali@example.com', 'gender']) expect(dump).not.toContain(secret)
  })
})

describe('get_lead — the production answer now grounds, invalid citations still do not', () => {
  const answer = (claims: unknown[]): AgentAnswer => ({ headline: 'Sali', claims: claims as never, unknown: null })

  it('ACCEPTS the three-measurement answer that production refused', async () => {
    const d = deps()
    await run(buildAgentTools(d).get_lead, { leadId: 1527 })
    const out = validateAgentAnswer(
      answer([
        { claimClass: 'OBSERVATION', text: '12 ימים ללא קשר.', metricEvidence: ['lead.daysSinceLastInteraction'] },
        { claimClass: 'OBSERVATION', text: '2 משימות באיחור.', metricEvidence: ['lead.overdueTaskCount'] },
        { claimClass: 'FACT', text: 'Sali בסטטוס מעוניין.', entityEvidence: ['1527'] },
      ]),
      d.evidence,
    )
    expect(out).not.toBeNull()
    expect(out!.claims).toHaveLength(3)
  })

  it('still REJECTS a raw numeric citation', async () => {
    const d = deps()
    await run(buildAgentTools(d).get_lead, { leadId: 1527 })
    expect(
      validateAgentAnswer(answer([{ claimClass: 'OBSERVATION', text: '12 ימים.', metricEvidence: ['12'] }]), d.evidence),
    ).toBeNull()
  })

  it('still REJECTS an invented metric id', async () => {
    const d = deps()
    await run(buildAgentTools(d).get_lead, { leadId: 1527 })
    expect(
      validateAgentAnswer(answer([{ claimClass: 'OBSERVATION', text: 'x', metricEvidence: ['lead.invented'] }]), d.evidence),
    ).toBeNull()
  })

  it('still REJECTS an OBSERVATION citing the lead id', async () => {
    const d = deps()
    await run(buildAgentTools(d).get_lead, { leadId: 1527 })
    expect(
      validateAgentAnswer(answer([{ claimClass: 'OBSERVATION', text: 'x', metricEvidence: ['1527'] }]), d.evidence),
    ).toBeNull()
  })
})

// ── get_conversation ─────────────────────────────────────────────────────────

describe('get_conversation message-id contract', () => {
  it('exposes the message id the evidence ledger records', async () => {
    const d = deps()
    const out = await run(buildAgentTools(d).get_conversation, { leadId: 1527 })
    const msgs = out.messages as Record<string, unknown>[]
    expect(msgs.map((m) => m.id)).toEqual([777, 784])
    for (const m of msgs) expect(d.evidence.has('message', String(m.id))).toBe(true)
  })

  it('keeps every existing message field intact', async () => {
    const out = await run(buildAgentTools(deps()).get_conversation, { leadId: 1527 })
    expect(Object.keys((out.messages as Record<string, unknown>[])[0]).sort()).toEqual([
      'at',
      'direction',
      'evidenceRef',
      'id',
      'sequence',
      'text',
    ])
  })

  it('ACCEPTS a FACT citing the canonical message reference', async () => {
    const d = deps()
    const out0 = await run(buildAgentTools(d).get_conversation, { leadId: 1527 })
    const ref = (out0.messages as Record<string, unknown>[])[0]!.evidenceRef as string
    expect(ref).toMatch(/^message:/)
    expect(
      validateAgentAnswer(
        { headline: 'x', claims: [{ claimClass: 'FACT', text: 'הלקוח כתב שלום.', entityEvidence: [ref] }], unknown: null },
        d.evidence,
      ),
    ).not.toBeNull()
  })

  it('ACCEPTS a FACT citing a real message id', async () => {
    const d = deps()
    await run(buildAgentTools(d).get_conversation, { leadId: 1527 })
    const out = validateAgentAnswer(
      { headline: 'x', claims: [{ claimClass: 'FACT', text: 'הלקוח כתב שלום.', entityEvidence: ['777'] }], unknown: null },
      d.evidence,
    )
    expect(out?.claims).toHaveLength(1)
  })

  it('still REJECTS a citation of the sequence number instead of the id', async () => {
    const d = deps()
    await run(buildAgentTools(d).get_conversation, { leadId: 1527 })
    expect(
      validateAgentAnswer(
        { headline: 'x', claims: [{ claimClass: 'FACT', text: 'x', entityEvidence: ['1'] }], unknown: null },
        d.evidence,
      ),
    ).toBeNull()
  })

  it('a message ref never satisfies a metric requirement', async () => {
    const d = deps()
    await run(buildAgentTools(d).get_conversation, { leadId: 1527 })
    expect(
      validateAgentAnswer(
        { headline: 'x', claims: [{ claimClass: 'OBSERVATION', text: 'x', metricEvidence: ['777'] }], unknown: null },
        d.evidence,
      ),
    ).toBeNull()
  })
})
