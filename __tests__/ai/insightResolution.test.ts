/**
 * Phase 4.4 — how an insight stops being true.
 *
 * The point of every test here is that resolution is decided by BUSINESS STATE
 * and nothing else: not by whether a notification was read, not by a model, and
 * not by a second predicate that could drift from the one admission uses.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { sweepInsightResolution, staleReasonFor, INSIGHT_TTL_MS } from '@/lib/ai/integration/insightResolution'
import { EXPECTED_STATE } from '@/lib/ai/integration/preconditions'
import type { LeadFact } from '@/lib/today/types'

const AGENCY = 9901
const NOW = new Date('2026-08-25T10:00:00.000Z')
const OVERDUE_AT = Date.parse('2026-08-23T08:00:00.000Z')

afterEach(() => {
  delete process.env.NOTIFICATIONS_ENABLED
  vi.restoreAllMocks()
})
const on = () => {
  process.env.NOTIFICATIONS_ENABLED = '1'
}

const insight = (over: Record<string, unknown> = {}) =>
  ({
    id: 1,
    agencyId: AGENCY,
    insightKey: 'lead:100:followup.overdue',
    subjectType: 'lead' as const,
    subjectId: '100',
    expectation: 'followup.overdue',
    investigationId: 'inv_1',
    operatorUserId: 42,
    headline: 'h',
    claims: [],
    evidence: [],
    reasoningChain: [],
    decisionTrace: [],
    status: 'open' as const,
    supersededById: null,
    resolvedReason: null,
    notificationJobId: null,
    deliveredAt: null,
    closedAt: null,
    createdAt: NOW.toISOString(),
    ...over,
  }) as never

/** A lead classifyLead genuinely calls FOLLOWUP_OVERDUE. */
const fact = (over: Partial<LeadFact> = {}): LeadFact => ({
  id: 100,
  name: null,
  phone: null,
  status: 'open',
  leadSource: 'manual',
  createdAt: OVERDUE_AT,
  nextFollowUpAt: OVERDUE_AT,
  lastActivityAt: OVERDUE_AT,
  lastInboundAt: null,
  lastHumanOutboundAt: null,
  hasOpenTask: false,
  earliestOpenTaskDueAt: null,
  ...over,
})

const stale = (readLeadFact: unknown, ins = insight(), now = NOW) =>
  staleReasonFor(ins, { now, ttlMs: INSIGHT_TTL_MS, readLeadFact: readLeadFact as never })

describe('C12 · classifyLead is the sole classifier', () => {
  it('a still-overdue lead keeps the insight live', async () => {
    expect(await stale(vi.fn(async () => fact()))).toBeNull()
  })

  it('a lead now WAITING_REPLY resolves it — the naive predicate would not', async () => {
    // Same passed nextFollowUpAt. A hand-rolled `nextFollowUpAt < dayStart` would
    // still call this overdue; classifyLead calls it WAITING_REPLY because the rep
    // owes a reply. That difference IS the reason for reuse.
    const waiting = fact({ lastInboundAt: NOW.getTime() - 1000, lastHumanOutboundAt: null })
    expect(await stale(vi.fn(async () => waiting))).toBe('business_state')
  })

  it('a followed-up lead resolves it', async () => {
    const done = fact({ nextFollowUpAt: NOW.getTime() + 86_400_000 })
    expect(await stale(vi.fn(async () => done))).toBe('business_state')
  })

  it('a gone / terminal / over-quota lead resolves as entity_gone', async () => {
    expect(await stale(vi.fn(async () => null))).toBe('entity_gone')
  })

  it('an unparseable subject resolves as entity_gone without a read', async () => {
    const read = vi.fn(async () => fact())
    expect(await stale(read, insight({ subjectId: 'not-a-number' }))).toBe('entity_gone')
    expect(read).not.toHaveBeenCalled()
  })

  it('an expectation with no declared state resolves rather than guessing', async () => {
    expect(
      await stale(
        vi.fn(async () => fact()),
        insight({ expectation: 'unknown.thing' }),
      ),
    ).toBe('business_state')
  })

  it('the expectation→state map is the SAME one admission uses', () => {
    expect(EXPECTED_STATE['followup.overdue']).toBe('FOLLOWUP_OVERDUE')
  })
})

describe('expiry is distinct from resolution', () => {
  it('ages out past the TTL, and says expired rather than resolved', async () => {
    const old = insight({ createdAt: new Date(NOW.getTime() - INSIGHT_TTL_MS - 1000).toISOString() })
    expect(
      await stale(
        vi.fn(async () => fact()),
        old,
      ),
    ).toBe('expired')
  })

  it('does not expire a moment early', async () => {
    const nearly = insight({ createdAt: new Date(NOW.getTime() - INSIGHT_TTL_MS + 60_000).toISOString() })
    expect(
      await stale(
        vi.fn(async () => fact()),
        nearly,
      ),
    ).toBeNull()
  })
})

describe('C11 · read/seen is a notification concern, never resolution', () => {
  it('the sweep never consults notification state', () => {
    const code = readFileSync('lib/ai/integration/insightResolution.ts', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')
    // Notification STATE — never consulted. The one notifications import is the
    // engine's kill switch, which decides whether the sweep RUNS, not what is true.
    expect(code).not.toMatch(/readAt|seenAt|groupCount|collapseKey|notification_jobs|notificationJobId/)
    expect(code).not.toMatch(/from '@\/db\/notifications/)
    expect(code).toMatch(/isNotificationsEnabled/)
    expect(code).toMatch(/classifyLead/)
  })

  it('a delivered-and-read insight whose state still holds stays open', async () => {
    const read = insight({ deliveredAt: NOW.toISOString(), notificationJobId: 7 })
    expect(
      await stale(
        vi.fn(async () => fact()),
        read,
      ),
    ).toBeNull()
  })
})

describe('the sweep itself', () => {
  const deps = (facts: unknown, rows = [insight()]) => ({
    listOpenInsights: vi.fn(async () => rows),
    closeInsight: vi.fn(async () => true),
    readLeadFact: facts,
  })

  it('is inert when notifications are disabled — no query at all', async () => {
    const d = deps(vi.fn(async () => null))
    const s = await sweepInsightResolution({ now: NOW, deps: d as never })
    expect(s).toEqual({ scanned: 0, resolvedStale: 0, expired: 0, errored: 0 })
    expect(d.listOpenInsights).not.toHaveBeenCalled()
  })

  it('closes a stale insight with the right status and reason', async () => {
    on()
    const d = deps(vi.fn(async () => null))
    const s = await sweepInsightResolution({ now: NOW, deps: d as never })
    expect(d.closeInsight).toHaveBeenCalledWith(1, 'resolved', 'entity_gone')
    expect(s.resolvedStale).toBe(1)
    expect(s.expired).toBe(0)
  })

  it('closes an aged insight as expired, counted separately', async () => {
    on()
    const old = insight({ createdAt: new Date(NOW.getTime() - INSIGHT_TTL_MS - 1).toISOString() })
    const d = deps(
      vi.fn(async () => fact()),
      [old],
    )
    const s = await sweepInsightResolution({ now: NOW, deps: d as never })
    expect(d.closeInsight).toHaveBeenCalledWith(1, 'expired', 'expired')
    expect(s.expired).toBe(1)
  })

  it('leaves a live insight alone', async () => {
    on()
    const d = deps(vi.fn(async () => fact()))
    const s = await sweepInsightResolution({ now: NOW, deps: d as never })
    expect(d.closeInsight).not.toHaveBeenCalled()
    expect(s.scanned).toBe(1)
  })

  it('one bad row never aborts the sweep', async () => {
    on()
    const d = deps(
      vi.fn(async () => {
        throw new Error('boom')
      }),
      [insight({ id: 1 }), insight({ id: 2 })],
    )
    const s = await sweepInsightResolution({ now: NOW, deps: d as never })
    expect(s.scanned).toBe(2)
    expect(s.errored).toBe(2)
  })

  it('never throws across its own boundary', async () => {
    on()
    const d = {
      listOpenInsights: vi.fn(async () => {
        throw new Error('db down')
      }),
      closeInsight: vi.fn(),
      readLeadFact: vi.fn(),
    }
    await expect(sweepInsightResolution({ now: NOW, deps: d as never })).resolves.toBeTruthy()
  })
})
