/**
 * The sessionless reader seam — the defect that dead-lettered production.
 *
 * Four `sla.open_loop` observations on agency 103 died with
 * "Cannot read properties of null (reading 'agencyId')". The Agent's readers
 * recovered the agency themselves through `getAgencyId()` -> `getUser()`, and
 * `getUser()` returns null on the cron path: there is no request session behind an
 * autonomous investigation.
 *
 * Every existing tool test mocks `@/db/briefing` and `@/lib/today/service`
 * wholesale, so the seam was never executed. These tests do the opposite: the
 * READERS are real and `getUser()` is real-shaped and returns null, exactly as in
 * production. A regression re-throws here rather than in a cron at 09:05.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { Roles } from '@/types/roles'

/**
 * A chainable knex stub. Everything is hoisted because `vi.mock` factories run
 * before module-level bindings exist.
 */
const { rows, dbStub, getUser } = vi.hoisted(() => {
  const rows: { current: unknown[] } = { current: [] }
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
      if (prop === 'raw') return (...a: unknown[]) => ({ __raw: a })
      if (prop === 'fn') return { now: () => 'now()' }
      return () => chainStub()
    },
  })
  /** getUser keeps its real shape and returns null — a cron has no session cookie. */
  return { rows, dbStub, getUser: vi.fn(async () => null) }
})

vi.mock('@/config/db', () => ({ db: dbStub }))
vi.mock('@/db/auth', () => ({ getUser }))
vi.mock('@/lib/quota', () => ({ getEffectiveLeadPlan: vi.fn(async () => 'pro') }))

// `@/db/agencies` is deliberately NOT mocked: getAgencyId() must remain able to
// throw exactly as it does in production, so "never reached" is a real claim.
import { getLeadsByName, getNamedLeadById, type SessionlessScope } from '@/db/briefing'
import { getBriefCandidateFacts } from '@/db/today/facts'
import { getTouchedTodayIds } from '@/db/today/handled'
import { readerScope } from '@/lib/agent/tools/readerScope'
import type { AgentScope } from '@/lib/agent/types'

const AGENT_SCOPE: AgentScope = {
  agencyId: 103,
  userId: 332,
  role: Roles.ADMIN,
  gotPermIds: [],
  plan: 'pro',
  firstName: 'עלמה',
}

const SCOPE: SessionlessScope = readerScope(AGENT_SCOPE)

beforeEach(() => {
  rows.current = []
  getUser.mockClear()
})

describe('the four Agent readers run with NO session when the agency is supplied', () => {
  it('getNamedLeadById — get_lead / get_conversation', async () => {
    rows.current = [{ id: 1502, firstName: 'דוד', lastName: null, status: 'contacted', nextFollowUpAt: null }]
    const r = await getNamedLeadById(SCOPE, 1502)
    expect(r?.id).toBe(1502)
    expect(getUser).not.toHaveBeenCalled()
  })

  it('getLeadsByName — find_lead', async () => {
    rows.current = [{ id: 1500, firstName: 'שרה', lastName: null, status: 'interested', nextFollowUpAt: null }]
    const r = await getLeadsByName(SCOPE, 'שרה')
    expect(r).toHaveLength(1)
    expect(getUser).not.toHaveBeenCalled()
  })

  it('getBriefCandidateFacts — get_today_state', async () => {
    rows.current = [{ id: 1498, status: 'contacted' }]
    await expect(getBriefCandidateFacts(SCOPE)).resolves.toBeInstanceOf(Array)
    expect(getUser).not.toHaveBeenCalled()
  })

  it('getTouchedTodayIds — get_today_state', async () => {
    rows.current = [{ id: 1503 }]
    await expect(getTouchedTodayIds(SCOPE, Date.parse('2026-08-26T00:00:00Z'))).resolves.toEqual([1503])
    expect(getUser).not.toHaveBeenCalled()
  })

  /**
   * The mutation guard. Without `?? (await getAgencyId())` these four reproduce the
   * production failure verbatim — so this asserts the failure is genuinely still
   * reachable when the agency is absent, which is what makes the tests above mean
   * something. Delete the fallback threading and the four tests above go red.
   */
  it('still fails the production way when NO agency is supplied (interactive shape, no session)', async () => {
    const sessionScope = { user: { role: Roles.ADMIN }, gotPermIds: [] }
    await expect(getNamedLeadById(sessionScope, 1502)).rejects.toThrow(/reading 'agencyId'/)
    expect(getUser).toHaveBeenCalled()
  })
})

describe('interactive callers are unchanged', () => {
  it('a scope with no agencyId still resolves it from the session', async () => {
    getUser.mockResolvedValueOnce({ id: 5, agencyId: 77 } as never)
    rows.current = [{ id: 9, firstName: 'א', lastName: null, status: 'new', nextFollowUpAt: null }]
    const r = await getNamedLeadById({ user: { role: Roles.AGNT }, gotPermIds: [5] }, 9)
    expect(r?.id).toBe(9)
    expect(getUser).toHaveBeenCalledTimes(1)
  })
})

/**
 * The class-level guard, scoped to CALL reachability rather than import
 * reachability.
 *
 * An import-graph walk is the wrong instrument: `lib/agent/tools` transitively
 * imports `db/worklist.ts`, `db/usersNTeams.ts` and most of `db/clients.ts`, none
 * of whose session-derived readers a tool ever calls. Asserting over those would
 * fail on code that is not in the Agent's path and would train the next engineer
 * to widen the allowlist.
 *
 * So the guard enumerates the readers the four tools ACTUALLY invoke, and asserts
 * that each one either takes its agency explicitly or falls back only behind a
 * supplied agency. Adding a reader to a tool without adding it here leaves it
 * unguarded — which is why the companion behavioural test below exists.
 */
describe('invariant · no unguarded session-derived agency resolution in the readers the Agent calls', () => {
  const ROOT = process.cwd()

  /** Every reader reachable from a tool's execute(), including via buildTodayBrief. */
  const AGENT_READERS: { file: string; fn: string }[] = [
    { file: 'db/briefing.ts', fn: 'getLeadsByName' },
    { file: 'db/briefing.ts', fn: 'getNamedLeadById' },
    { file: 'db/today/facts.ts', fn: 'getBriefCandidateFacts' },
    { file: 'db/today/handled.ts', fn: 'getTouchedTodayIds' },
    { file: 'db/today/freshness.ts', fn: 'getInboundSyncFreshness' },
    { file: 'db/meetings.ts', fn: 'getTodaysMeetings' },
    { file: 'db/inboxWaiting.ts', fn: 'listOldestWaitingWhatsappByLeadIds' },
    { file: 'db/agentConversation.ts', fn: 'findLatestLeadConversation' },
    { file: 'db/agentConversation.ts', fn: 'listAgentConversationMessages' },
    { file: 'lib/today/service.ts', fn: 'buildTodayBrief' },
    { file: 'db/agentRevenue.ts', fn: 'getRevenueTotals' },
    { file: 'db/agentLeadDetail.ts', fn: 'getLeadForAgency' },
    { file: 'db/agentLeadDetail.ts', fn: 'getFamilyMembersForAgency' },
    { file: 'db/agentLeadDetail.ts', fn: 'getRecentLeadTasksForAgency' },
  ]

  function body(file: string, fn: string): string {
    const src = readFileSync(path.join(ROOT, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    const lines = src.split('\n')
    const start = lines.findIndex((l) => new RegExp(`^export (async )?function ${fn}\\b`).test(l))
    expect(start, `${file} :: ${fn} not found — the reader was renamed or removed`).toBeGreaterThan(-1)
    const end = lines.findIndex((l, i) => i > start && l === '}')
    return lines
      .slice(start, end + 1)
      .map((l) => l.split('//')[0])
      .join('\n')
  }

  it.each(AGENT_READERS)('$file :: $fn resolves no agency from the session', ({ file, fn }) => {
    const b = body(file, fn)
    for (const bad of ['requireUser()', 'getUser()']) {
      expect(b, `${file} :: ${fn} calls ${bad}`).not.toContain(bad)
    }
    if (b.includes('getAgencyId()')) {
      expect(b, `${file} :: ${fn} calls getAgencyId() without an explicitly supplied agency`).toMatch(
        /\?\?\s*\(await getAgencyId\(\)\)/,
      )
    }
  })

  /**
   * `get_lead` enriches through `getLeadIntelligenceInputs`. Its interactive
   * reads (`getFullLead` and friends) call `requireUser()`; on a sessionless run
   * that used to throw, and the `.catch` turned it into a lead with no source,
   * handler, activity, tasks or notes. The tool now SUPPLIES the agency, which
   * routes the reads through db/agentLeadDetail.ts (guarded above). The `.catch`
   * stays: a failed enrichment must degrade, never fail the investigation.
   * Behaviour is pinned in getLeadSessionless.test.ts.
   */
  it('get_lead supplies the agency to its enrichment, and keeps it non-fatal', () => {
    const tool = readFileSync(path.join(ROOT, 'lib/agent/tools/getLead.ts'), 'utf8')
    expect(tool).toContain('getLeadIntelligenceInputs(leadId, { agencyId: deps.scope.agencyId }).catch(() => null)')
  })

  it('the four tool modules build their reader scope through readerScope()', () => {
    for (const t of ['findLead', 'getLead', 'getConversation', 'getTodayState', 'getRevenue']) {
      const src = readFileSync(path.join(ROOT, `lib/agent/tools/${t}.ts`), 'utf8')
      expect(src, `${t}.ts must build its reader scope through readerScope()`).toContain('readerScope(deps.scope)')
      expect(src).not.toMatch(/\{\s*user:\s*\{\s*role:\s*deps\.scope\.role\s*\}\s*,\s*gotPermIds:\s*deps\.scope\.gotPermIds\s*\}/)
    }
  })
})
