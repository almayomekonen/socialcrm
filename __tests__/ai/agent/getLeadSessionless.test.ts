/**
 * `get_lead` on a sessionless path (the WhatsApp owner assistant, autonomous runs).
 *
 * The defect: the tool's enrichment went through `getLeadIntelligenceInputs` ->
 * `getFullLead` / `getFamMembers` / `get5TasksByClientId`, each of which calls
 * `requireUser()`. With no request cookie that throws, the tool's
 * `.catch(() => null)` swallowed it, and the owner's "מה עם דנה?" was answered
 * from a lead with no source, no handler, no days-since-contact and no tasks,
 * with nothing in the logs.
 *
 * Here the readers are REAL and `getUser()` keeps its real shape and returns
 * null, exactly as on the WhatsApp worker. Only the database is stubbed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Roles } from '@/types/roles'

const { rows, dbStub, getUser } = vi.hoisted(() => {
  const rows: { current: Record<string, unknown>[] } = { current: [] }
  const chainStub = (): unknown => {
    const proxy: unknown = new Proxy(function () {} as unknown as object, {
      apply: () => proxy,
      get: (_t, prop) => {
        if (prop === 'then')
          return (ok: (v: unknown) => unknown, no?: (e: unknown) => unknown) => Promise.resolve(rows.current).then(ok, no)
        if (prop === 'first') return () => Promise.resolve(rows.current[0])
        return () => proxy
      },
    })
    return proxy
  }
  const dbStub: unknown = new Proxy(function () {} as unknown as object, {
    apply: () => chainStub(),
    get: (_t, prop) => {
      if (prop === 'raw') return async () => ({ rows: [{ taskCount: 2, completedCount: 1, overdueCount: 1, lastCreatedAt: null, lastCompletedAt: null }] })
      if (prop === 'fn') return { now: () => 'now()' }
      return () => chainStub()
    },
  })
  return { rows, dbStub, getUser: vi.fn(async () => null) }
})

vi.mock('@/config/db', () => ({ db: dbStub }))
vi.mock('@/db/auth', () => ({ getUser }))
vi.mock('@/lib/quota', () => ({ getEffectiveLeadPlan: vi.fn(async () => 'pro') }))

import { makeGetLead } from '@/lib/agent/tools/getLead'
import { getLeadIntelligenceInputs } from '@/db/aiSummaries'
import { createEvidenceCollector } from '@/lib/agent/evidence'
import { createBudget } from '@/lib/agent/budget'
import type { AgentScope } from '@/lib/agent/types'

const SCOPE: AgentScope = { agencyId: 103, userId: 332, role: Roles.ADMIN, gotPermIds: [], plan: 'pro', firstName: 'עלמה' }
const OPTS = { toolCallId: 't1', messages: [] } as never

/** One row serves every query: the gate, the lead, the handler name and the task list. */
const LEAD_ROW = {
  id: 1502,
  firstName: 'דנה',
  lastName: 'לוי',
  status: 'contacted',
  nextFollowUpAt: null,
  leadSource: 'פייסבוק',
  handlerId: 7,
  name: 'רון',
  /** The real column shape: GENERATED `firstName lastName (idNum)` (migration 20260414000001). */
  details: 'דנה לוי (039876541)',
  lastActivityAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
  statusChangedAt: new Date(Date.now() - 5 * 86_400_000).toISOString(),
  createdAt: new Date(Date.now() - 10 * 86_400_000).toISOString(),
  updatedAt: null,
  lastOutcomeType: null,
  title: 'להתקשר לדנה',
  completed: false,
}

function runTool() {
  const t = makeGetLead({
    scope: SCOPE,
    evidence: createEvidenceCollector(),
    budget: createBudget({ maxSteps: 6, deadlineMs: 60_000, now: () => 0 }),
    nowMs: Date.now(),
  })
  return (t as unknown as { execute: (i: unknown, o: unknown) => Promise<Record<string, any>> }).execute({ leadId: 1502 }, OPTS)
}

beforeEach(() => {
  rows.current = [LEAD_ROW]
  getUser.mockClear()
})

describe('get_lead with no session (WhatsApp owner assistant)', () => {
  it('returns the enriched lead: source, handler, days since contact and tasks', async () => {
    const r = await runTool()
    expect(r.found).toBe(true)
    expect(r.leadSource).toBe('פייסבוק')
    expect(r.handlerName).toBe('רון')
    expect(r.daysSinceLastInteraction).toBe(3)
    expect(r.daysInCurrentStatus).toBe(5)
    expect(r.overdueTaskCount).toBe(1)
    expect(r.recentTasks).toHaveLength(1)
  })

  it('never hands the model the ID number inside clients.details', async () => {
    const r = await runTool()
    expect(r).not.toHaveProperty('notes')
    expect(JSON.stringify(r)).not.toContain('039876541')
  })

  it('never resolves identity from the session on that path', async () => {
    await runTool()
    expect(getUser).not.toHaveBeenCalled()
  })

  it('the reader, given an agency, never touches the session', async () => {
    const snap = await getLeadIntelligenceInputs(1502, { agencyId: 103 })
    expect(snap?.inputs.leadSource).toBe('פייסבוק')
    expect(getUser).not.toHaveBeenCalled()
  })

  it('a lead outside the supplied agency yields nothing', async () => {
    rows.current = []
    await expect(getLeadIntelligenceInputs(1502, { agencyId: 103 })).resolves.toBeNull()
  })
})

describe('interactive callers are unchanged', () => {
  it('with no agency supplied, the reader still resolves the user from the session', async () => {
    getUser.mockResolvedValue({ id: 5, agencyId: 77, role: Roles.ADMIN } as never)
    const snap = await getLeadIntelligenceInputs(1502)
    expect(snap?.inputs.leadSource).toBe('פייסבוק')
    expect(getUser).toHaveBeenCalled()
    getUser.mockResolvedValue(null)
  })
})
