import { beforeEach, describe, expect, it, vi } from 'vitest'

const getLeadTotals = vi.hoisted(() => vi.fn())
const getOverdueFollowUps = vi.hoisted(() => vi.fn())
const getLeadsWithoutNextStep = vi.hoisted(() => vi.fn())
const getActivityWindow = vi.hoisted(() => vi.fn())
import { createEvidenceCollector } from '@/lib/agent/evidence'
import { createBudget } from '@/lib/agent/budget'
import type { AgentScope } from '@/lib/agent/types'
import { Roles } from '@/types/roles'

const getLeadsByName = vi.hoisted(() => vi.fn())
const getNamedLeadById = vi.hoisted(() => vi.fn())
const getLeadIntelligenceInputs = vi.hoisted(() => vi.fn())

vi.mock('@/db/briefing', () => ({ getLeadsByName, getNamedLeadById }))
vi.mock('@/db/agentBusiness', () => ({ getLeadTotals, getOverdueFollowUps, getLeadsWithoutNextStep, getActivityWindow }))
vi.mock('@/db/aiSummaries', () => ({ getLeadIntelligenceInputs }))
vi.mock('@/lib/today/service', () => ({ buildTodayBrief: vi.fn() }))
vi.mock('@/db/agentConversation', () => ({
  findLatestLeadConversation: vi.fn(),
  listAgentConversationMessages: vi.fn(),
  AGENT_MESSAGE_LIMIT_DEFAULT: 30,
  AGENT_MESSAGE_LIMIT_MAX: 60,
}))

import { buildAgentTools } from '@/lib/agent/tools'

/**
 * find_lead — the entry point the reachability graph was missing.
 *
 * Every other lead tool is keyed by leadId, and the only source of ids was
 * today's queue. A lead outside it was unreachable: production proved it, with a
 * three-step investigation for "מי זה Sali?" that collected 40 evidence items and
 * still had to refuse, while Sali sat in the database as lead 1527.
 *
 * The security posture is inherited, not re-implemented. `getLeadsByName` is the
 * SAME gate `get_lead` already trusts — it resolves the agency itself from the
 * session via getAgencyId(), applies gotPermIds for non-admins, the free-plan
 * overQuota filter and `lead = true`. This tool passes the scope-derived
 * permission set and nothing else, so a caller cannot widen what it sees.
 */

const SCOPE: AgentScope = { agencyId: 7, userId: 3, role: Roles.ADMIN, gotPermIds: [], plan: 'pro', firstName: 'עלמה' }
const AGENT: AgentScope = { ...SCOPE, role: Roles.AGNT, gotPermIds: [3, 9] }
const OPTS = { toolCallId: 't', messages: [] } as never
const run = (t: unknown, i: unknown) =>
  (t as { execute: (i: unknown, o: unknown) => Promise<Record<string, unknown>> }).execute(i, OPTS)

function deps(scope: AgentScope = SCOPE) {
  return {
    scope,
    evidence: createEvidenceCollector(),
    budget: createBudget({ maxSteps: 6, deadlineMs: 60_000, now: () => 0 }),
    nowMs: 0,
  }
}

const SALI = { id: 1527, name: 'Sali', status: 'interested', nextFollowUpAt: null }
const DAVID = { id: 1557, name: 'David Cohen', status: 'new', nextFollowUpAt: '2026-08-25T09:00:00.000Z' }

beforeEach(() => {
  getLeadsByName.mockReset().mockResolvedValue([SALI])
  getNamedLeadById.mockReset().mockResolvedValue(null)
  getLeadIntelligenceInputs.mockReset().mockResolvedValue(null)
})

describe('the tool surface gains exactly one entry point', () => {
  it('exposes find_lead alongside the other read-only tools', () => {
    expect(Object.keys(buildAgentTools(deps())).sort()).toEqual(['find_lead', 'get_activity_trends', 'get_business_summary', 'get_conversation', 'get_follow_up_health', 'get_lead', 'get_lead_health', 'get_lead_segment', 'get_revenue', 'get_today_state', 'list_meetings'])
  })

  // F / L — the security contract of the input schema.
  it('no scope, agency, user or identity field exists in the input schema', () => {
    const t = buildAgentTools(deps()).find_lead as unknown as { inputSchema: { shape: Record<string, unknown> } }
    expect(Object.keys(t.inputSchema.shape)).toEqual(['name'])
    for (const forbidden of ['agencyId', 'userId', 'role', 'plan', 'gotPermIds', 'permissions', 'leadId'])
      expect(Object.keys(t.inputSchema.shape)).not.toContain(forbidden)
  })

  it('has a description that routes the model to it before the id-keyed tools', () => {
    const t = buildAgentTools(deps()).find_lead as unknown as { description: string }
    expect(t.description).toMatch(/name/i)
    expect(t.description).toMatch(/get_lead|get_conversation/)
  })
})

describe('search behaviour', () => {
  // A
  it('returns a matching lead with the approved projection', async () => {
    const out = await run(buildAgentTools(deps()).find_lead, { name: 'Sali' })
    expect(out.total).toBe(1)
    expect(out.matches).toEqual([
      { leadId: 1527, evidenceRef: 'lead:1527', name: 'Sali', status: 'interested', nextFollowUpAt: null },
    ])
  })

  // B — the reader owns the matching semantics; the tool must not re-implement them.
  it('delegates matching to getLeadsByName verbatim', async () => {
    await run(buildAgentTools(deps()).find_lead, { name: 'sal' })
    expect(getLeadsByName).toHaveBeenCalledTimes(1)
    expect(getLeadsByName.mock.calls[0]![1]).toBe('sal')
  })

  // C
  it('handles zero matches without inventing anything', async () => {
    getLeadsByName.mockResolvedValue([])
    const out = await run(buildAgentTools(deps()).find_lead, { name: 'nobody' })
    expect(out).toEqual({ matches: [], total: 0 })
  })

  // D
  it('returns multiple candidates rather than choosing one', async () => {
    getLeadsByName.mockResolvedValue([SALI, DAVID])
    const out = await run(buildAgentTools(deps()).find_lead, { name: 'a' })
    expect(out.total).toBe(2)
    expect((out.matches as { leadId: number }[]).map((m) => m.leadId)).toEqual([1527, 1557])
  })

  it('rejects an empty or whitespace-only name without touching the reader', async () => {
    const out = await run(buildAgentTools(deps()).find_lead, { name: '   ' })
    expect(out).toEqual({ matches: [], total: 0 })
    expect(getLeadsByName).not.toHaveBeenCalled()
  })

  it('exposes no field beyond the approved projection', async () => {
    getLeadsByName.mockResolvedValue([{ ...SALI, phone: '050-0000000', email: 'x@y.z' } as never])
    const out = await run(buildAgentTools(deps()).find_lead, { name: 'Sali' })
    // `evidenceRef` is the canonical citation string the model is told to copy.
    // It carries no new information — it is the id it sits beside — so it does
    // not widen what the model can see, and the phone assertion below still
    // pins the boundary this test exists for.
    expect(Object.keys((out.matches as Record<string, unknown>[])[0]).sort()).toEqual([
      'evidenceRef',
      'leadId',
      'name',
      'nextFollowUpAt',
      'status',
    ])
    expect(JSON.stringify(out)).not.toContain('050-0000000')
  })
})

describe('evidence', () => {
  // E
  it('records one lead ref per match', async () => {
    getLeadsByName.mockResolvedValue([SALI, DAVID])
    const d = deps()
    await run(buildAgentTools(d).find_lead, { name: 'a' })
    expect(d.evidence.has('lead', '1527')).toBe(true)
    expect(d.evidence.has('lead', '1557')).toBe(true)
    expect(d.evidence.size()).toBe(2)
  })

  it('records nothing when nothing matched', async () => {
    getLeadsByName.mockResolvedValue([])
    const d = deps()
    await run(buildAgentTools(d).find_lead, { name: 'nobody' })
    expect(d.evidence.size()).toBe(0)
  })
})

describe('authorization and isolation', () => {
  // G / H — the scope the reader receives is the session's, never the caller's.
  it('passes the server-derived permission scope, and only that', async () => {
    await run(buildAgentTools(deps(AGENT)).find_lead, { name: 'Sali' })
    // agencyId is part of the gate now: the reader must never re-derive it from a session.
    expect(getLeadsByName).toHaveBeenCalledWith({ user: { role: Roles.AGNT }, gotPermIds: [3, 9], agencyId: 7 }, 'Sali')
  })

  it('an admin scope carries the admin role through unchanged', async () => {
    await run(buildAgentTools(deps()).find_lead, { name: 'Sali' })
    expect(getLeadsByName.mock.calls[0]![0]).toEqual({ user: { role: Roles.ADMIN }, gotPermIds: [], agencyId: 7 })
  })

  it('a cross-agency search yields nothing — the reader is the gate', async () => {
    // getLeadsByName resolves the agency from the session itself; a lead in
    // another agency simply never appears in its result set.
    getLeadsByName.mockResolvedValue([])
    const d = deps()
    const out = await run(buildAgentTools(d).find_lead, { name: 'other-agency-lead' })
    expect(out).toEqual({ matches: [], total: 0 })
    expect(d.evidence.size()).toBe(0)
  })
})

describe('budget', () => {
  // I
  it('refuses once the step ceiling is reached', async () => {
    const d = { ...deps(), budget: createBudget({ maxSteps: 1, deadlineMs: 60_000, now: () => 0 }) }
    const tools = buildAgentTools(d)
    await run(tools.find_lead, { name: 'a' })
    const second = await run(tools.find_lead, { name: 'b' })
    expect(second).toEqual({ refused: true, reason: 'step_ceiling' })
  })

  it('refuses an identical repeat search', async () => {
    const tools = buildAgentTools(deps())
    await run(tools.find_lead, { name: 'Sali' })
    expect(await run(tools.find_lead, { name: 'Sali' })).toEqual({ refused: true, reason: 'repeat_call' })
  })

  it('consumes the step before the reader is consulted', async () => {
    const d = { ...deps(), budget: createBudget({ maxSteps: 0, deadlineMs: 60_000, now: () => 0 }) }
    await run(buildAgentTools(d).find_lead, { name: 'Sali' })
    expect(getLeadsByName).not.toHaveBeenCalled()
  })
})

describe('multi-step reachability — the reason this tool exists', () => {
  // J / K — a lead outside today's queue becomes investigable.
  it('find_lead feeds get_lead for a lead today never mentioned', async () => {
    getLeadsByName.mockResolvedValue([SALI])
    getNamedLeadById.mockResolvedValue({ id: 1527, name: 'Sali', status: 'interested', nextFollowUpAt: null })
    const d = deps()
    const tools = buildAgentTools(d)

    const found = await run(tools.find_lead, { name: 'Sali' })
    const leadId = (found.matches as { leadId: number }[])[0].leadId
    const detail = await run(tools.get_lead, { leadId })

    expect(leadId).toBe(1527)
    expect(detail.found).toBe(true)
    expect(getNamedLeadById).toHaveBeenCalledWith({ user: { role: Roles.ADMIN }, gotPermIds: [], agencyId: 7 }, 1527)
    expect(d.evidence.has('lead', '1527')).toBe(true)
  })

  it('the id comes from the tool result, never from the caller', async () => {
    const t = buildAgentTools(deps()).find_lead as unknown as { inputSchema: { shape: Record<string, unknown> } }
    expect(Object.keys(t.inputSchema.shape)).not.toContain('leadId')
  })
})
