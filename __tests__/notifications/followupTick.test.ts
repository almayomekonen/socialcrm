/**
 * Task 5 — followup.due / followup.overdue tick.
 *
 * Proves: instant-based due, BUSINESS_TZ overdue, eventKey idempotency,
 * reschedule/clear safety, terminal/non-lead exclusion, shared collapse,
 * DST-safe day bounds. VITEST_NO_DB=1 safe.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BUSINESS_TZ } from '@/lib/today/constants'
import { businessDayBounds, startOfBusinessDayMs } from '@/lib/today/time'
import { eventKeyForEvent, followupAtEventKey } from '@/lib/notifications/eventKey'
import { followupKey } from '@/lib/notifications/collapseKeys'
import type { EventContext, NotificationEvent } from '@/lib/notifications/types'

const notifyEvent = vi.fn()
const isNotificationsEnabled = vi.fn()
const findFollowupsDue = vi.fn()
const findFollowupsOverdue = vi.fn()

vi.mock('@/lib/notifications/emit', () => ({
  notifyEvent: (...args: unknown[]) => notifyEvent(...args),
}))

vi.mock('@/lib/notifications/flags', () => ({
  isNotificationsEnabled: (...args: unknown[]) => isNotificationsEnabled(...args),
}))

vi.mock('@/db/notifications/followups', async () => {
  const actual = await vi.importActual<typeof import('@/db/notifications/followups')>(
    '@/db/notifications/followups',
  )
  return {
    ...actual,
    findFollowupsDue: (...args: unknown[]) => findFollowupsDue(...args),
    findFollowupsOverdue: (...args: unknown[]) => findFollowupsOverdue(...args),
  }
})

const { tickFollowupNotifications } = await import('@/lib/notifications/followupTick')
const { findFollowupsDueQuery, findFollowupsOverdueQuery } = await import('@/db/notifications/followups')

/** 2026-08-12 15:00 Asia/Jerusalem (IDT = UTC+3) → 12:00Z */
const NOW_MS = Date.parse('2026-08-12T12:00:00.000Z')
const { dayStart, dayEnd } = businessDayBounds(NOW_MS, BUSINESS_TZ)

beforeEach(() => {
  notifyEvent.mockReset()
  notifyEvent.mockResolvedValue({ enqueued: true, jobId: 1 })
  isNotificationsEnabled.mockReset()
  isNotificationsEnabled.mockReturnValue(true)
  findFollowupsDue.mockReset()
  findFollowupsOverdue.mockReset()
  findFollowupsDue.mockResolvedValue([])
  findFollowupsOverdue.mockResolvedValue([])
})

describe('BUSINESS_TZ day bounds (DST-safe)', () => {
  it('uses Asia/Jerusalem and keeps [dayStart, dayEnd) one wall day', () => {
    expect(BUSINESS_TZ).toBe('Asia/Jerusalem')
    expect(dayEnd - dayStart).toBeGreaterThanOrEqual(23 * 3_600_000)
    expect(dayEnd - dayStart).toBeLessThanOrEqual(25 * 3_600_000)
  })

  it('DST spring-forward still yields a single business day', () => {
    // Israel DST spring 2026: clocks spring forward late March.
    const during = Date.parse('2026-03-28T12:00:00.000Z')
    const bounds = businessDayBounds(during, BUSINESS_TZ)
    expect(bounds.dayEnd).toBe(startOfBusinessDayMs(bounds.dayStart + 26 * 3_600_000, BUSINESS_TZ))
    expect(bounds.dayEnd).toBeGreaterThan(bounds.dayStart)
  })
})

describe('candidate SQL shape', () => {
  const sqlOf = (q: { toSQL: () => { sql: string; bindings: readonly unknown[] } }) => {
    const { sql, bindings } = q.toSQL()
    return { lower: sql.toLowerCase(), bindings }
  }

  it('due query: lead, non-terminal, nextFollowUpAt <= now and >= dayStart, bounded', () => {
    const now = new Date(NOW_MS)
    const start = new Date(dayStart)
    const { lower, bindings } = sqlOf(findFollowupsDueQuery(now, start, 200))
    expect(lower).toContain('c.lead = true')
    expect(lower).toContain(`status is distinct from 'closed'`)
    expect(lower).toContain(`status is distinct from 'lost'`)
    expect(lower).toContain('c."nextfollowupat" is not null')
    expect(lower).toContain('c."nextfollowupat" <=')
    expect(lower).toContain('c."nextfollowupat" >=')
    expect(lower).toContain('limit')
    expect(bindings).toEqual([now, start, 200])
  })

  it('overdue query: nextFollowUpAt < dayStart only (no leadSource heuristics)', () => {
    const start = new Date(dayStart)
    const { lower, bindings } = sqlOf(findFollowupsOverdueQuery(start, 200))
    expect(lower).toContain('c."nextfollowupat" <')
    expect(lower).not.toContain('leadsource')
    expect(bindings).toEqual([start, 200])
  })
})

describe('eventKey + collapse', () => {
  const at = Date.parse('2026-08-12T15:00:00.000Z')

  it('stable keys use persisted followUpAt ms, never Date.now()', () => {
    const due: NotificationEvent = {
      type: 'followup.due',
      agencyId: 7,
      entityType: 'lead',
      entityId: 42,
      occurredAt: new Date(NOW_MS),
      payload: { followUpAt: at, leadName: 'דנה' },
    }
    const overdue: NotificationEvent = { ...due, type: 'followup.overdue' }
    expect(followupAtEventKey(due)).toBe(`followup.due:7:lead:42:at:${at}`)
    expect(eventKeyForEvent(due)).toBe(`followup.due:7:lead:42:at:${at}`)
    expect(eventKeyForEvent(overdue)).toBe(`followup.overdue:7:lead:42:at:${at}`)
    expect(eventKeyForEvent(due)).not.toBe(eventKeyForEvent(overdue))
  })

  it('due and overdue share collapse key lead:{id}:followup', () => {
    const ctx = (type: 'followup.due' | 'followup.overdue'): EventContext => ({
      type,
      agencyId: 7,
      entityType: 'lead',
      entityId: 42,
      actorUserId: null,
      occurredAt: new Date(NOW_MS),
      payload: { followUpAt: at },
      groupCount: 1,
    })
    expect(followupKey(ctx('followup.due'))).toBe('lead:42:followup')
    expect(followupKey(ctx('followup.overdue'))).toBe('lead:42:followup')
  })
})

describe('tickFollowupNotifications', () => {
  it('A — future follow-up: finder not given future rows; no emit', async () => {
    // Selection excludes nextFollowUpAt > now; empty due list ⇒ no notify.
    findFollowupsDue.mockResolvedValue([])
    await tickFollowupNotifications({ nowMs: NOW_MS })
    expect(notifyEvent).not.toHaveBeenCalled()
  })

  it('B — exact due timestamp: emits followup.due with followUpAt discriminator', async () => {
    const at = new Date(NOW_MS) // exactly now
    findFollowupsDue.mockResolvedValue([
      { id: 42, agencyId: 7, firstName: 'דנה', lastName: 'לוי', nextFollowUpAt: at },
    ])

    const summary = await tickFollowupNotifications({ nowMs: NOW_MS })
    expect(notifyEvent).toHaveBeenCalledTimes(1)
    expect(notifyEvent.mock.calls[0][0]).toMatchObject({
      type: 'followup.due',
      agencyId: 7,
      entityType: 'lead',
      entityId: 42,
      actorUserId: null,
      payload: { leadName: 'דנה לוי', followUpAt: at.getTime() },
    })
    expect(summary.enqueuedDue).toBe(1)
  })

  it('C — repeated due tick: same event payload (idempotent at notifyEvent)', async () => {
    const at = new Date(dayStart + 10 * 3_600_000)
    const row = { id: 42, agencyId: 7, firstName: 'A', lastName: null, nextFollowUpAt: at }
    findFollowupsDue.mockResolvedValue([row])
    notifyEvent
      .mockResolvedValueOnce({ enqueued: true, jobId: 1 })
      .mockResolvedValueOnce({ enqueued: false, reason: 'duplicate' })

    expect((await tickFollowupNotifications({ nowMs: NOW_MS })).enqueuedDue).toBe(1)
    expect((await tickFollowupNotifications({ nowMs: NOW_MS })).enqueuedDue).toBe(0)
    expect(notifyEvent.mock.calls[0][0].payload.followUpAt).toBe(at.getTime())
    expect(notifyEvent.mock.calls[1][0].payload.followUpAt).toBe(at.getTime())
  })

  it('D — reschedule: tick only sees CURRENT nextFollowUpAt (old instant absent)', async () => {
    const oldAt = new Date(dayStart + 2 * 3_600_000)
    const newAt = new Date(dayStart + 8 * 3_600_000)
    // After reschedule, SQL returns only the current row (newAt). Old instant never appears.
    findFollowupsDue.mockResolvedValue([
      { id: 42, agencyId: 7, firstName: 'A', lastName: null, nextFollowUpAt: newAt },
    ])
    await tickFollowupNotifications({ nowMs: NOW_MS })
    expect(notifyEvent.mock.calls[0][0].payload.followUpAt).toBe(newAt.getTime())
    expect(notifyEvent.mock.calls[0][0].payload.followUpAt).not.toBe(oldAt.getTime())
  })

  it('E — cleared follow-up: empty candidates → no emit', async () => {
    findFollowupsDue.mockResolvedValue([])
    findFollowupsOverdue.mockResolvedValue([])
    await tickFollowupNotifications({ nowMs: NOW_MS })
    expect(notifyEvent).not.toHaveBeenCalled()
  })

  it('F — next BUSINESS_TZ day: unresolved follow-up becomes overdue', async () => {
    const yesterdayAfternoon = new Date(dayStart - 6 * 3_600_000)
    findFollowupsOverdue.mockResolvedValue([
      { id: 9, agencyId: 7, firstName: 'יובל', lastName: null, nextFollowUpAt: yesterdayAfternoon },
    ])
    const summary = await tickFollowupNotifications({ nowMs: NOW_MS })
    expect(notifyEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'followup.overdue',
        entityId: 9,
        payload: expect.objectContaining({ followUpAt: yesterdayAfternoon.getTime() }),
      }),
    )
    expect(summary.enqueuedOverdue).toBe(1)
    // Finder receives dayStart — not a fabricated overdue clock.
    expect(findFollowupsOverdue.mock.calls[0][0].getTime()).toBe(dayStart)
  })

  it('G/H — closed/lost/non-lead excluded by SQL (tick never sees them)', async () => {
    const { lower } = (() => {
      const { sql } = findFollowupsDueQuery(new Date(NOW_MS), new Date(dayStart), 10).toSQL()
      return { lower: sql.toLowerCase() }
    })()
    expect(lower).toContain('c.lead = true')
    expect(lower).toContain(`'closed'`)
    expect(lower).toContain(`'lost'`)
  })

  it('J — due then overdue: two types, shared collapse key', async () => {
    const dueAt = new Date(dayStart + 3 * 3_600_000)
    const overdueAt = new Date(dayStart - 3 * 3_600_000)
    findFollowupsDue.mockResolvedValue([
      { id: 1, agencyId: 7, firstName: 'D', lastName: null, nextFollowUpAt: dueAt },
    ])
    findFollowupsOverdue.mockResolvedValue([
      { id: 2, agencyId: 7, firstName: 'O', lastName: null, nextFollowUpAt: overdueAt },
    ])
    await tickFollowupNotifications({ nowMs: NOW_MS })
    expect(notifyEvent.mock.calls.map((c) => c[0].type)).toEqual(['followup.due', 'followup.overdue'])
    expect(followupKey({ entityId: 1 } as EventContext)).toBe('lead:1:followup')
    expect(followupKey({ entityId: 2 } as EventContext)).toBe('lead:2:followup')
  })

  it('passes now/dayStart into due finder (instant trigger, not midnight)', async () => {
    await tickFollowupNotifications({ nowMs: NOW_MS, limit: 50 })
    expect(findFollowupsDue).toHaveBeenCalledWith(new Date(NOW_MS), new Date(dayStart), 50)
    // 17:59 vs 18:00 is encoded as nextFollowUpAt <= now in SQL — dayStart alone is not the trigger.
    expect(dayStart).toBeLessThan(NOW_MS)
  })
})
