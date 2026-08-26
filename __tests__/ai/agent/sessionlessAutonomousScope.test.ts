/**
 * P5 — the precondition that killed four production observations.
 *
 * `resolveAutonomousScope` was written to be sessionless and says so in its own
 * header. It avoided `requireProductAccess` and resolved the operator through the
 * notification engine's own recipient rule. One call slipped through: `getPerms`,
 * whose ADMIN branch reaches `getUsersAndTeams()` -> `getAgencyId()` -> `getUser()`.
 * On agency 103 the single handler is an admin, so every `sla.open_loop`
 * observation took that branch and threw before any reservation existed.
 *
 * These tests run the REAL `resolveAutonomousScope` with `getPerms` mocked to throw
 * exactly what production threw. If the admin branch is ever re-introduced, the
 * first test reproduces the outage instead of a cron doing it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Roles } from '@/types/roles'

const { rows, dbStub, getPerms, resolveRecipients, buildRecipientContext, resolveAiAccess } = vi.hoisted(() => {
  const rows: { current: unknown[] } = { current: [] }
  const chain = (): unknown => {
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
  return {
    rows,
    dbStub: new Proxy(function () {} as unknown as object, {
      apply: () => chain(),
      get: (_t, p) => (p === 'raw' ? (...a: unknown[]) => ({ __raw: a }) : () => chain()),
    }),
    /**
     * The production failure, verbatim. `getPerms`'s admin branch cannot run
     * without a session, so any call at all from this path is the bug.
     */
    getPerms: vi.fn(async () => {
      throw new TypeError("Cannot read properties of null (reading 'agencyId')")
    }),
    resolveRecipients: vi.fn(() => [332]),
    buildRecipientContext: vi.fn(async () => ({})),
    resolveAiAccess: vi.fn(async () => ({ allowed: true as const })),
  }
})

vi.mock('@/config/db', () => ({ db: dbStub }))
vi.mock('@/db/filter', () => ({ getPerms }))
vi.mock('@/db/notifications/recipients', () => ({ resolveRecipients, buildRecipientContext }))
vi.mock('@/lib/ai/access', () => ({ resolveAiAccess }))
vi.mock('@/lib/quota', () => ({ getEffectiveLeadPlan: vi.fn(async () => 'pro') }))

import { resolveAutonomousScope } from '@/lib/ai/integration/autonomousScope'
import { checkPreconditions } from '@/lib/ai/integration/preconditions'
import type { SignalJob } from '@/db/ai/signalJobs'
import type { LeadFact } from '@/lib/today/types'

beforeEach(() => {
  getPerms.mockClear()
  resolveRecipients.mockReturnValue([332])
})

describe('resolveAutonomousScope · ADMIN operator, no session', () => {
  it('succeeds without ever calling getPerms — the exact production case', async () => {
    rows.current = [{ id: 332, agencyId: 103, role: Roles.ADMIN, firstName: 'עלמה', lastName: null }]

    const r = await resolveAutonomousScope({ agencyId: 103, leadId: 1502 })

    expect(r.ok).toBe(true)
    if (r.ok === false) throw new Error('unreachable')
    expect(r.scope.agencyId).toBe(103)
    expect(r.scope.userId).toBe(332)
    expect(r.scope.role).toBe(Roles.ADMIN)
    // Unrestricted. This is the value getPerms' admin branch returned, and the
    // value `scopedLeads` skips the whereIn for. Identical, minus the session.
    expect(r.scope.gotPermIds).toEqual([])
    expect(getPerms).not.toHaveBeenCalled()
  })

  it('is equally sessionless for a GM operator (isAdmin covers ADMIN and GM)', async () => {
    rows.current = [{ id: 900, agencyId: 103, role: Roles.GM, firstName: 'ג', lastName: null }]
    resolveRecipients.mockReturnValue([900])

    const r = await resolveAutonomousScope({ agencyId: 103, leadId: 1502 })

    expect(r.ok).toBe(true)
    expect(getPerms).not.toHaveBeenCalled()
  })
})

describe('resolveAutonomousScope · non-admin operator keeps its permission set', () => {
  it('calls getPerms and threads gotPermIds through unchanged', async () => {
    rows.current = [{ id: 55, agencyId: 103, role: Roles.AGNT, firstName: 'ד', lastName: null }]
    resolveRecipients.mockReturnValue([55])
    getPerms.mockImplementationOnce(async () => ({ gotPermIds: [55, 91] }) as never)

    const r = await resolveAutonomousScope({ agencyId: 103, leadId: 1502 })

    expect(r.ok).toBe(true)
    if (r.ok === false) throw new Error('unreachable')
    expect(r.scope.gotPermIds).toEqual([55, 91])
    expect(getPerms).toHaveBeenCalledTimes(1)
  })

  it('a non-admin permission failure is NOT swallowed — it still propagates', async () => {
    rows.current = [{ id: 55, agencyId: 103, role: Roles.AGNT, firstName: 'ד', lastName: null }]
    resolveRecipients.mockReturnValue([55])
    await expect(resolveAutonomousScope({ agencyId: 103, leadId: 1502 })).rejects.toThrow(/reading 'agencyId'/)
  })
})

describe('resolveAutonomousScope · tenancy is still re-checked at read', () => {
  it('refuses an operator row that does not belong to the agency', async () => {
    rows.current = []
    const r = await resolveAutonomousScope({ agencyId: 103, leadId: 1502 })
    expect(r).toEqual({ ok: false, reason: 'operator_unreadable' })
    expect(getPerms).not.toHaveBeenCalled()
  })

  it('refuses when no recipient resolves', async () => {
    resolveRecipients.mockReturnValue([])
    const r = await resolveAutonomousScope({ agencyId: 103, leadId: 1502 })
    expect(r).toEqual({ ok: false, reason: 'no_operator' })
  })

  it('refuses when the agency is not entitled', async () => {
    resolveAiAccess.mockResolvedValueOnce({ allowed: false, reason: 'subscription-required' } as never)
    const r = await resolveAutonomousScope({ agencyId: 103, leadId: 1502 })
    expect(r).toEqual({ ok: false, reason: 'not_entitled' })
  })
})

/**
 * The production scenario, end to end, with only the database replaced.
 *
 * Real `sla.open_loop` job · real ownership registry · real `classifyLead` · real
 * `resolveAutonomousScope` · real admin operator · no session. This is what agency
 * 103 ran at 09:05, and it is the assertion that would have stopped the outage.
 */
describe('P5 end-to-end · the exact observation that dead-lettered production', () => {
  const NOW = new Date('2026-08-26T09:05:00.000Z')
  /** Contacted, silent for 3 days: OPEN_LOOP_SLA (SLA 24h, ceiling 14d). */
  const LAST_ACTIVITY = Date.parse('2026-08-23T09:00:00.000Z')

  const job: SignalJob = {
    id: 10866,
    agencyId: 103,
    observationKey: 'sla.open_loop:lead:1502:at:2026-08-26T09:05:19.298Z',
    expectation: 'sla.open_loop',
    subjectType: 'lead',
    subjectId: '1502',
    signal: { absence: { expectedBy: '2026-08-24T09:00:00.000Z' } } as SignalJob['signal'],
    status: 'leased',
    attempts: 1,
    maxAttempts: 3,
    detectedAt: NOW.toISOString(),
    createdAt: NOW.toISOString(),
  }

  const fact: LeadFact = {
    id: 1502,
    name: null,
    phone: null,
    status: 'contacted',
    leadSource: 'whatsapp:inbound',
    createdAt: LAST_ACTIVITY,
    nextFollowUpAt: null,
    lastActivityAt: LAST_ACTIVITY,
    lastInboundAt: null,
    lastHumanOutboundAt: null,
    hasOpenTask: false,
    earliestOpenTaskDueAt: null,
  }

  it('preconditions now PASS for an admin-handled lead with no session', async () => {
    rows.current = [{ id: 332, agencyId: 103, role: Roles.ADMIN, firstName: 'עלמה', lastName: null }]

    const r = await checkPreconditions(job, {
      now: NOW,
      deps: {
        readLeadFact: vi.fn(async () => fact),
        lastReservationForSubject: vi.fn(async () => null),
        // resolveAutonomousScope is the REAL one — that is the point of this test.
      },
    })

    expect(r.proceed, r.proceed === false ? `declined: ${r.code} — ${r.detail}` : '').toBe(true)
    if (r.proceed === false) throw new Error('unreachable')
    expect(r.state).toBe('OPEN_LOOP_SLA')
    expect(r.operatorUserId).toBe(332)
    expect(r.scope.agencyId).toBe(103)
    // P1 passed because sla.open_loop is genuinely unowned in the real registry.
    expect(r.value.ownedByDeterministicNotification).toBe(false)
    // The session hop that threw in production was never taken.
    expect(getPerms).not.toHaveBeenCalled()
  })

  it('an owned expectation is still declined for free, before the operator is resolved', async () => {
    rows.current = [{ id: 332, agencyId: 103, role: Roles.ADMIN, firstName: 'עלמה', lastName: null }]
    const readLeadFact = vi.fn(async () => fact)

    const r = await checkPreconditions(
      { ...job, expectation: 'followup.overdue' },
      { now: NOW, deps: { readLeadFact, lastReservationForSubject: vi.fn(async () => null) } },
    )

    expect(r.proceed).toBe(false)
    if (r.proceed === true) throw new Error('unreachable')
    expect(r.code).toBe('owned_by_deterministic_notification')
    expect(readLeadFact).not.toHaveBeenCalled()
  })
})
