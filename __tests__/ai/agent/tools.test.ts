/**
 * B3 — the first three read-only Agent tools.
 *
 * These pin the security boundary, not just the happy path: scope lives in the
 * closure and never in a tool's input schema, authorization runs BEFORE
 * enrichment, PII/demographics never reach the model, and every returned fact
 * carries citable evidence.
 *
 * Runs under VITEST_NO_DB=1 — every reader is mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getLeadTotals = vi.hoisted(() => vi.fn())
const getOverdueFollowUps = vi.hoisted(() => vi.fn())
const getLeadsWithoutNextStep = vi.hoisted(() => vi.fn())
const getActivityWindow = vi.hoisted(() => vi.fn())

const buildTodayBrief = vi.hoisted(() => vi.fn())
const getNamedLeadById = vi.hoisted(() => vi.fn())
const getLeadIntelligenceInputs = vi.hoisted(() => vi.fn())
const findLatestLeadConversation = vi.hoisted(() => vi.fn())
const listAgentConversationMessages = vi.hoisted(() => vi.fn())

vi.mock('@/lib/today/service', () => ({ buildTodayBrief }))
vi.mock('@/db/briefing', () => ({ getNamedLeadById }))
vi.mock('@/db/agentBusiness', () => ({ getLeadTotals, getOverdueFollowUps, getLeadsWithoutNextStep, getActivityWindow }))
vi.mock('@/db/aiSummaries', () => ({ getLeadIntelligenceInputs }))
vi.mock('@/db/agentConversation', () => ({
  findLatestLeadConversation,
  listAgentConversationMessages,
  AGENT_MESSAGE_LIMIT_DEFAULT: 30,
  AGENT_MESSAGE_LIMIT_MAX: 60,
}))

import { buildAgentTools } from '@/lib/agent/tools'
import { createEvidenceCollector } from '@/lib/agent/evidence'
import { createBudget } from '@/lib/agent/budget'
import type { AgentScope } from '@/lib/agent/types'
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

// The AI SDK passes (input, options) to execute; options is unused by our tools.
const OPTS = { toolCallId: 't1', messages: [] } as never
const run = (t: unknown, input: unknown) =>
  (t as { execute: (i: unknown, o: unknown) => Promise<Record<string, unknown>> }).execute(input, OPTS)

const BRIEF = {
  greeting: 'בוקר טוב',
  firstName: 'עלמה',
  items: [
    {
      id: 15015,
      name: 'דנה',
      phone: '0501234567',
      state: 'WAITING_REPLY',
      reason: 'ממתין לתשובה',
      targetSurface: 'inbox',
      // WIP-only fields — must never appear in the projection.
      conversationId: 991,
      href: '/inbox?c=991',
      waitingFor: 'ממתין 7 שעות',
      windowHint: 'נותרו 5 שעות',
    },
  ],
  total: 1,
  remaining: 1,
  handledToday: 0,
  done: false,
  volumeState: 'clear',
  statusVerdict: 'covered',
  permissionVerdict: 'scoped_all_clear',
  meetings: [{ id: 5, title: 'שיחה עם דנה', at: 1_700_000_000_000 }],
}

const LEAD_INPUTS = {
  inputs: {
    status: 'contacted',
    leadSource: 'whatsapp:wamid.X',
    handlerName: 'רותם',
    daysSinceLastInteraction: 3,
    daysInCurrentStatus: 9,
    daysSinceLastTask: 2,
    overdueTaskCount: 1,
    taskCompletionRate: 0.5,
    lastOutcomeType: 'call_reached',
    detailsExcerpt: 'ביקש הצעה',
    recentTasks: Array.from({ length: 8 }, (_, i) => ({ title: `משימה ${i}`, status: 'open', daysOld: i })),
    // PII / demographics that must never reach the model.
    phone: '0501234567',
    email: 'dana@example.com',
    gender: 'נקבה',
    familyStatus: 'נשואה',
    ageYears: 41,
    familyMemberCount: 3,
    hasEmail: true,
    hasPhone: true,
  },
  updatedAtIso: null,
}

beforeEach(() => {
  buildTodayBrief.mockReset().mockResolvedValue(BRIEF)
  getNamedLeadById.mockReset().mockResolvedValue({ id: 15015, name: 'דנה', status: 'contacted', nextFollowUpAt: null })
  getLeadIntelligenceInputs.mockReset().mockResolvedValue(LEAD_INPUTS)
  findLatestLeadConversation.mockReset().mockResolvedValue({ conversationId: 991, messageCount: 120 })
  listAgentConversationMessages.mockReset().mockResolvedValue([
    { id: 5001, sequence: 118, direction: 'inbound', text: 'מה המחיר?', timestamp: '2026-08-24T09:00:00.000Z' },
    { id: 5002, sequence: 119, direction: 'outbound', text: 'נציג יחזור אליך', timestamp: '2026-08-24T09:05:00.000Z' },
  ])
})

// ─── Tool surface & scope safety ────────────────────────────────────────────

describe('agent tool surface', () => {
  it('exposes exactly the nine read-only tools', () => {
    expect(Object.keys(buildAgentTools(deps())).sort()).toEqual(['find_lead', 'get_activity_trends', 'get_business_summary', 'get_conversation', 'get_follow_up_health', 'get_lead', 'get_lead_health', 'get_lead_segment', 'get_today_state'])
  })

  it('no tool input schema accepts a scope field', () => {
    const tools = buildAgentTools(deps())
    for (const [name, t] of Object.entries(tools)) {
      const shape = JSON.stringify((t as { inputSchema: unknown }).inputSchema)
      for (const forbidden of ['agencyId', 'userId', 'gotPermIds', 'plan', 'role']) {
        expect(shape, `${name} must not accept ${forbidden}`).not.toContain(forbidden)
      }
    }
  })

  it('every tool has a description the model can route on', () => {
    for (const t of Object.values(buildAgentTools(deps()))) {
      expect((t as { description?: string }).description ?? '').not.toHaveLength(0)
    }
  })
})

// ─── get_today_state ────────────────────────────────────────────────────────

describe('get_today_state', () => {
  it('takes no input and passes the server-derived scope to the Today engine', async () => {
    const d = deps()
    await run(buildAgentTools(d).get_today_state, {})
    const viewer = buildTodayBrief.mock.calls[0][0]
    expect(viewer).toEqual({
      scope: { user: { role: Roles.ADMIN }, gotPermIds: [], agencyId: 7 },
      agencyId: 7,
      userId: 3,
      firstName: 'עלמה',
    })
  })

  it('returns the approved projection fields', async () => {
    const out = await run(buildAgentTools(deps()).get_today_state, {})
    expect(out.total).toBe(1)
    expect(out.remaining).toBe(1)
    expect(out.handledToday).toBe(0)
    expect(out.volumeState).toBe('clear')
    expect(out.statusVerdict).toBe('covered')
    expect(out.meetings).toEqual([{ title: 'שיחה עם דנה', at: '2023-11-14T22:13:20.000Z' }])
  })

  it('projects only the HEAD-stable BriefItem fields — no WIP-dependent fields', async () => {
    const out = await run(buildAgentTools(deps()).get_today_state, {})
    const item = (out.items as Record<string, unknown>[])[0]
    expect(Object.keys(item).sort()).toEqual(['evidenceRef', 'leadId', 'name', 'reason', 'state', 'targetSurface'])
    for (const wip of ['conversationId', 'href', 'waitingFor', 'windowHint']) {
      expect(item).not.toHaveProperty(wip)
    }
  })

  it('never leaks a phone number to the model', async () => {
    const out = await run(buildAgentTools(deps()).get_today_state, {})
    expect(JSON.stringify(out)).not.toContain('0501234567')
  })

  it('does not cap the item count — the Today engine is data-driven', async () => {
    buildTodayBrief.mockResolvedValue({
      ...BRIEF,
      items: Array.from({ length: 47 }, (_, i) => ({ ...BRIEF.items[0], id: 1000 + i })),
      total: 47,
      remaining: 47,
    })
    const out = await run(buildAgentTools(deps()).get_today_state, {})
    expect((out.items as unknown[]).length).toBe(47)
  })

  it('records metric evidence and one lead ref per item', async () => {
    const d = deps()
    await run(buildAgentTools(d).get_today_state, {})
    expect(d.evidence.hasMetric('today.total')).toBe(true)
    expect(d.evidence.hasMetric('today.remaining')).toBe(true)
    expect(d.evidence.has('lead', '15015')).toBe(true)
  })

  it('refuses an identical repeat call through the budget', async () => {
    const d = deps()
    const tools = buildAgentTools(d)
    await run(tools.get_today_state, {})
    expect(await run(tools.get_today_state, {})).toMatchObject({ refused: true, reason: 'repeat_call' })
  })
})

// ─── get_lead ───────────────────────────────────────────────────────────────

describe('get_lead', () => {
  it('returns the lead when the scope authorizes it', async () => {
    const out = await run(buildAgentTools(deps()).get_lead, { leadId: 15015 })
    expect(out).toMatchObject({ found: true, leadId: 15015, name: 'דנה', status: 'contacted', handlerName: 'רותם' })
  })

  it('gates on getNamedLeadById with the server-derived scope', async () => {
    await run(buildAgentTools(deps()).get_lead, { leadId: 15015 })
    expect(getNamedLeadById).toHaveBeenCalledWith({ user: { role: Roles.ADMIN }, gotPermIds: [], agencyId: 7 }, 15015)
  })

  it('denies an unauthorized or cross-agency lead as not-found', async () => {
    getNamedLeadById.mockResolvedValue(null)
    const out = await run(buildAgentTools(deps()).get_lead, { leadId: 999 })
    expect(out).toEqual({ found: false, leadId: 999 })
  })

  it('NEVER enriches before authorization succeeds', async () => {
    getNamedLeadById.mockResolvedValue(null)
    await run(buildAgentTools(deps()).get_lead, { leadId: 999 })
    expect(getLeadIntelligenceInputs).not.toHaveBeenCalled()
  })

  it('records no evidence for a denied lead', async () => {
    getNamedLeadById.mockResolvedValue(null)
    const d = deps()
    await run(buildAgentTools(d).get_lead, { leadId: 999 })
    expect(d.evidence.size()).toBe(0)
  })

  it('strips PII and demographics from the projection', async () => {
    const out = await run(buildAgentTools(deps()).get_lead, { leadId: 15015 })
    for (const forbidden of ['phone', 'email', 'gender', 'familyStatus', 'ageYears', 'familyMemberCount']) {
      expect(out).not.toHaveProperty(forbidden)
    }
    const serialized = JSON.stringify(out)
    expect(serialized).not.toContain('0501234567')
    expect(serialized).not.toContain('dana@example.com')
    expect(serialized).not.toContain('נשואה')
  })

  it('caps recentTasks at five', async () => {
    const out = await run(buildAgentTools(deps()).get_lead, { leadId: 15015 })
    expect((out.recentTasks as unknown[]).length).toBe(5)
  })

  it('surfaces the outcome as a label, not the internal code', async () => {
    const out = await run(buildAgentTools(deps()).get_lead, { leadId: 15015 })
    expect(out.lastOutcome).toBe('דיברנו')
    expect(JSON.stringify(out)).not.toContain('call_reached')
  })

  it('records the lead ref plus a metric ref for every measurement it exposes', async () => {
    // The measurements were always returned; they now carry citable identifiers,
    // because an OBSERVATION must name a metric and previously had none to name.
    const d = deps()
    const out = await run(buildAgentTools(d).get_lead, { leadId: 15015 })
    expect(d.evidence.has('lead', '15015')).toBe(true)

    const metricIds = d.evidence
      .all()
      .filter((e) => e.kind === 'metric')
      .map((e) => (e as { metric: string }).metric)
      .sort()
    expect(metricIds).toEqual(Object.keys(out.metrics as object).sort())
    // Exactly the lead ref and those metrics — nothing else is recorded.
    expect(d.evidence.size()).toBe(1 + metricIds.length)
  })

  it('still answers when enrichment is unavailable', async () => {
    getLeadIntelligenceInputs.mockResolvedValue(null)
    const out = await run(buildAgentTools(deps()).get_lead, { leadId: 15015 })
    expect(out).toMatchObject({ found: true, leadId: 15015, name: 'דנה' })
  })

  it('a won deal (lead=false) is not-found — the CRM visibility rule is unchanged', async () => {
    // scopedLeads filters `lead = true`; Close Deal sets lead=false. The tool
    // reports the existing behaviour rather than working around it.
    getNamedLeadById.mockResolvedValue(null)
    expect(await run(buildAgentTools(deps()).get_lead, { leadId: 15015 })).toEqual({ found: false, leadId: 15015 })
  })
})

// ─── get_conversation ───────────────────────────────────────────────────────

describe('get_conversation', () => {
  it('returns bounded messages for an authorized lead', async () => {
    const out = await run(buildAgentTools(deps()).get_conversation, { leadId: 15015 })
    expect(out).toMatchObject({ found: true, leadId: 15015, conversationId: 991, returned: 2 })
    expect((out.messages as unknown[]).length).toBe(2)
  })

  it('gates on the lead before touching any conversation reader', async () => {
    getNamedLeadById.mockResolvedValue(null)
    const out = await run(buildAgentTools(deps()).get_conversation, { leadId: 999 })
    expect(out).toEqual({ found: false, leadId: 999 })
    expect(findLatestLeadConversation).not.toHaveBeenCalled()
    expect(listAgentConversationMessages).not.toHaveBeenCalled()
  })

  it('handles a lead with no conversation safely', async () => {
    findLatestLeadConversation.mockResolvedValue(null)
    const out = await run(buildAgentTools(deps()).get_conversation, { leadId: 15015 })
    expect(out).toMatchObject({ found: true, conversationId: null, returned: 0, messages: [] })
    expect(listAgentConversationMessages).not.toHaveBeenCalled()
  })

  it('passes the server-derived agencyId to both readers — never a model value', async () => {
    await run(buildAgentTools(deps()).get_conversation, { leadId: 15015 })
    expect(findLatestLeadConversation).toHaveBeenCalledWith({ agencyId: 7, leadId: 15015 })
    expect(listAgentConversationMessages).toHaveBeenCalledWith({ agencyId: 7, conversationId: 991, limit: 30 })
  })

  it('defaults the limit to 30', async () => {
    await run(buildAgentTools(deps()).get_conversation, { leadId: 15015 })
    expect(listAgentConversationMessages.mock.calls[0][0].limit).toBe(30)
  })

  it('honours an explicit limit within range', async () => {
    await run(buildAgentTools(deps()).get_conversation, { leadId: 15015, limit: 45 })
    expect(listAgentConversationMessages.mock.calls[0][0].limit).toBe(45)
  })

  it('rejects a limit above the maximum at the schema', () => {
    const schema = (buildAgentTools(deps()).get_conversation as { inputSchema: { safeParse(v: unknown): { success: boolean } } })
      .inputSchema
    expect(schema.safeParse({ leadId: 1, limit: 61 }).success).toBe(false)
    expect(schema.safeParse({ leadId: 1, limit: 9 }).success).toBe(false)
    expect(schema.safeParse({ leadId: 1, limit: 60 }).success).toBe(true)
    expect(schema.safeParse({ leadId: 1, limit: 10 }).success).toBe(true)
  })

  it('rejects a non-positive leadId at the schema', () => {
    const schema = (buildAgentTools(deps()).get_conversation as { inputSchema: { safeParse(v: unknown): { success: boolean } } })
      .inputSchema
    expect(schema.safeParse({ leadId: 0 }).success).toBe(false)
    expect(schema.safeParse({ leadId: -1 }).success).toBe(false)
  })

  it('reports the true total alongside the bounded window', async () => {
    const out = await run(buildAgentTools(deps()).get_conversation, { leadId: 15015 })
    expect(out.messageCount).toBe(120)
    expect(out.returned).toBe(2)
  })

  it('records a lead ref plus one message ref per returned message', async () => {
    const d = deps()
    await run(buildAgentTools(d).get_conversation, { leadId: 15015 })
    expect(d.evidence.has('lead', '15015')).toBe(true)
    expect(d.evidence.has('message', '5001')).toBe(true)
    expect(d.evidence.has('message', '5002')).toBe(true)
    expect(d.evidence.size()).toBe(3)
  })

  it('never claims an outbound message was sent by a human — no discriminator exists', async () => {
    const out = await run(buildAgentTools(deps()).get_conversation, { leadId: 15015 })
    const serialized = JSON.stringify(out)
    for (const claim of ['author', 'rep', 'ai', 'human', 'auto_response']) {
      expect(serialized).not.toContain(claim)
    }
    // Direction is the only attribution the source data supports.
    expect((out.messages as Record<string, unknown>[])[1].direction).toBe('outbound')
  })

  it('refuses an identical repeat call through the budget', async () => {
    const d = deps()
    const tools = buildAgentTools(d)
    await run(tools.get_conversation, { leadId: 15015 })
    expect(await run(tools.get_conversation, { leadId: 15015 })).toMatchObject({ refused: true, reason: 'repeat_call' })
  })
})
