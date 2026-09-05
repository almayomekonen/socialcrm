/**
 * The two CRM tools added to connect "הסוכן שלך" to the agent brain, and the
 * boundaries they must not cross.
 *
 * These pin behaviour that would be invisible in a screenshot and expensive to
 * discover in production: that the agency travels from the server-resolved
 * closure rather than the session, that a counts-only tool cannot ground a claim
 * about a named person, and that the budget still governs the new surface.
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
const getNamedLeadById = vi.hoisted(() => vi.fn())

vi.mock('@/lib/today/service', () => ({ buildTodayBrief: vi.fn() }))
vi.mock('@/db/aiSummaries', () => ({ getLeadIntelligenceInputs: vi.fn() }))
vi.mock('@/db/agentConversation', () => ({
  findLatestLeadConversation: vi.fn(),
  listAgentConversationMessages: vi.fn(),
  AGENT_MESSAGE_LIMIT_DEFAULT: 30,
  AGENT_MESSAGE_LIMIT_MAX: 60,
}))
vi.mock('@/db/briefing', () => ({
  getNamedLeadById,
  getFollowUpsDueToday,
  getLeadsNotContactedRecently,
  getNewLeadsThisWeek,
  getOverdueTaskSummary,
  getPromisedButWaiting,
  getUnreadInboxSummary,
}))

import { buildAgentTools } from '@/lib/agent/tools'
import { createEvidenceCollector } from '@/lib/agent/evidence'
import { createBudget } from '@/lib/agent/budget'
import type { AgentScope, EvidenceRef } from '@/lib/agent/types'
import { Roles } from '@/types/roles'

const SCOPE: AgentScope = {
  agencyId: 7,
  userId: 3,
  role: Roles.ADMIN,
  gotPermIds: [],
  plan: 'pro',
  firstName: 'עלמה',
}

function deps(scope: AgentScope = SCOPE) {
  return {
    scope,
    evidence: createEvidenceCollector(),
    budget: createBudget({ maxSteps: 6, deadlineMs: 60_000, now: () => 0 }),
    nowMs: 0,
  }
}

const OPTS = { toolCallId: 't1', messages: [] } as never
const run = (t: unknown, input: unknown) =>
  (t as { execute: (i: unknown, o: unknown) => Promise<Record<string, unknown>> }).execute(input, OPTS)

const LIST = (total: number) => ({
  total,
  sample: Array.from({ length: Math.min(total, 2) }, (_, i) => ({
    id: 100 + i,
    name: `ליד ${i}`,
    status: 'new',
  })),
})

beforeEach(() => {
  vi.clearAllMocks()
  getFollowUpsDueToday.mockResolvedValue(LIST(3))
  getLeadsNotContactedRecently.mockResolvedValue(LIST(11))
  getNewLeadsThisWeek.mockResolvedValue(LIST(5))
  getOverdueTaskSummary.mockResolvedValue(LIST(2))
  getPromisedButWaiting.mockResolvedValue(LIST(4))
  getUnreadInboxSummary.mockResolvedValue({ conversations: 6, unread: 9 })
})

// ─── Authorization ──────────────────────────────────────────────────────────

describe('authorization travels in the closure, never in the model input', () => {
  it('neither new tool accepts a scope field', () => {
    const tools = buildAgentTools(deps()) as Record<string, { inputSchema: unknown }>
    for (const name of ['get_lead_segment', 'get_business_summary']) {
      const shape = JSON.stringify(tools[name]!.inputSchema)
      for (const forbidden of ['agencyId', 'userId', 'gotPermIds', 'plan', 'role']) {
        expect(shape, `${name} must not accept ${forbidden}`).not.toContain(forbidden)
      }
    }
  })

  it('get_lead_segment hands the readers the scope agency, not an ambient one', async () => {
    await run(buildAgentTools(deps()).get_lead_segment, { segment: 'waiting_for_reply' })
    expect(getPromisedButWaiting).toHaveBeenCalledWith(
      expect.objectContaining({ agencyId: 7, gotPermIds: [], user: { role: Roles.ADMIN } }),
    )
  })

  it('get_business_summary hands every reader the same scope agency', async () => {
    await run(buildAgentTools(deps()).get_business_summary, {})
    for (const reader of [
      getFollowUpsDueToday,
      getLeadsNotContactedRecently,
      getNewLeadsThisWeek,
      getOverdueTaskSummary,
      getPromisedButWaiting,
      getUnreadInboxSummary,
    ]) {
      expect(reader).toHaveBeenCalledWith(expect.objectContaining({ agencyId: 7 }))
    }
  })

  it('a different scope reaches the readers as a different agency', async () => {
    await run(buildAgentTools(deps({ ...SCOPE, agencyId: 99 })).get_lead_segment, { segment: 'new_this_week' })
    expect(getNewLeadsThisWeek).toHaveBeenCalledWith(expect.objectContaining({ agencyId: 99 }))
    // The point of the assertion: agency 7's rows were never requested.
    expect(getNewLeadsThisWeek).not.toHaveBeenCalledWith(expect.objectContaining({ agencyId: 7 }))
  })

  it('a non-admin carries its permission set into the reader', async () => {
    const scoped = { ...SCOPE, role: Roles.AGNT, gotPermIds: [3, 4] }
    await run(buildAgentTools(deps(scoped)).get_lead_segment, { segment: 'overdue_tasks' })
    expect(getOverdueTaskSummary).toHaveBeenCalledWith(
      expect.objectContaining({ agencyId: 7, gotPermIds: [3, 4] }),
    )
  })
})

// ─── Grounding ──────────────────────────────────────────────────────────────

describe('grounding — what each tool makes citable', () => {
  it('get_business_summary emits metrics ONLY, so no claim about a person can rest on it', async () => {
    const d = deps()
    await run(buildAgentTools(d).get_business_summary, {})
    const refs = d.evidence.all()
    expect(refs.length).toBeGreaterThan(0)
    expect(refs.every((r: EvidenceRef) => r.kind === 'metric')).toBe(true)
    // A FACT names an entity; with no entity evidence there is nothing to cite.
    expect(refs.some((r: EvidenceRef) => r.kind === 'lead')).toBe(false)
  })

  it('get_lead_segment makes every returned lead citable', async () => {
    const d = deps()
    const out = await run(buildAgentTools(d).get_lead_segment, { segment: 'not_contacted_recently' })
    for (const lead of out.sample as { leadId: number }[]) {
      expect(d.evidence.has('lead', String(lead.leadId))).toBe(true)
    }
  })

  it('the segment metric carries the TRUE total, not the sample length', async () => {
    const d = deps()
    const out = await run(buildAgentTools(d).get_lead_segment, { segment: 'not_contacted_recently' })
    expect(out.total).toBe(11)
    expect((out.sample as unknown[]).length).toBe(2)
    // Understating the workload by exactly the sample cap is the failure this
    // guards: an OBSERVATION citing this metric must say 11, never 2.
    const metric = d.evidence.all().find((r) => r.kind === 'metric')
    expect(metric).toMatchObject({ metric: 'segment.not_contacted_recently', n: 11 })
    expect(out.truncated).toBe(true)
  })

  it('exposes the metric IDENTIFIER, not only its value', async () => {
    const out = await run(buildAgentTools(deps()).get_business_summary, {})
    // A claim may only cite a name the collector holds; hiding the id would make
    // every count-shaped answer uncitable.
    expect(Object.keys(out.metrics as object)).toContain('business.waiting_for_reply')
  })
})

// ─── Budget ─────────────────────────────────────────────────────────────────

describe('the budget still governs the new surface', () => {
  it('refuses a repeated segment call without spending a step', async () => {
    const d = deps()
    const tool = buildAgentTools(d).get_lead_segment
    await run(tool, { segment: 'new_this_week' })
    const second = await run(tool, { segment: 'new_this_week' })
    expect(second.refused).toBe(true)
    expect(second.reason).toBe('repeat_call')
    expect(d.budget.stepsUsed()).toBe(1)
  })

  it('a different segment is a different call and is allowed', async () => {
    const d = deps()
    const tool = buildAgentTools(d).get_lead_segment
    await run(tool, { segment: 'new_this_week' })
    const second = await run(tool, { segment: 'overdue_tasks' })
    expect(second.refused).toBeUndefined()
    expect(d.budget.stepsUsed()).toBe(2)
  })

  it('reports each admitted call to the progress observer, in order', async () => {
    const seen: { tool: string; step: number }[] = []
    const d = {
      scope: SCOPE,
      evidence: createEvidenceCollector(),
      budget: createBudget({ maxSteps: 6, deadlineMs: 60_000, now: () => 0, onStep: (e) => seen.push(e) }),
      nowMs: 0,
    }
    const tools = buildAgentTools(d)
    await run(tools.get_business_summary, {})
    await run(tools.get_lead_segment, { segment: 'new_this_week' })
    expect(seen).toEqual([
      { tool: 'get_business_summary', step: 1 },
      { tool: 'get_lead_segment', step: 2 },
    ])
  })

  it('a throwing observer cannot fail the tool call', async () => {
    const d = {
      scope: SCOPE,
      evidence: createEvidenceCollector(),
      budget: createBudget({
        maxSteps: 6,
        deadlineMs: 60_000,
        now: () => 0,
        onStep: () => {
          throw new Error('listener exploded')
        },
      }),
      nowMs: 0,
    }
    await expect(run(buildAgentTools(d).get_business_summary, {})).resolves.toMatchObject({
      metrics: expect.any(Object),
    })
  })
})

// ─── Tool selection ─────────────────────────────────────────────────────────

describe('tool descriptions route the model to the right capability', () => {
  it('separates the queue, the overview and the segments', () => {
    const tools = buildAgentTools(deps()) as Record<string, { description: string }>
    expect(tools.get_today_state!.description).toMatch(/what needs attention|what should I do/i)
    expect(tools.get_business_summary!.description).toMatch(/count/i)
    expect(tools.get_lead_segment!.description).toMatch(/segment|categor/i)
    // The summary must send the model onward for names rather than inviting it
    // to answer about individuals from counts.
    expect(tools.get_business_summary!.description).toMatch(/no names/i)
  })

  it('every segment id is described for the model', () => {
    const tool = buildAgentTools(deps()).get_lead_segment as unknown as {
      inputSchema: { shape: { segment: { description?: string } } }
    }
    const described = tool.inputSchema.shape.segment.description ?? ''
    for (const id of ['followups_due_today', 'not_contacted_recently', 'new_this_week', 'overdue_tasks', 'waiting_for_reply']) {
      expect(described).toContain(id)
    }
  })
})
