import { describe, expect, it } from 'vitest'
import { classifyLead, isInboundSource, orderAndDedupe, targetSurfaceFor } from '@/lib/today/classify'
import { businessDayBounds, startOfBusinessDayMs } from '@/lib/today/time'
import { completenessVerdict } from '@/lib/today/verdict'
import { progress, volumeStateFor } from '@/lib/today/progress'
import { HIGH_VOLUME_THRESHOLD } from '@/lib/today/constants'
import type { LeadFact, NowCtx, PermissionVerdict } from '@/lib/today/types'

// Fixed reference: 2026-07-20 12:00 Israel (summer, UTC+3) = 09:00 UTC.
const NOW = Date.UTC(2026, 6, 20, 9, 0, 0)
const CTX: NowCtx = businessDayBounds(NOW)
const H = 3_600_000
const D = 86_400_000

const BASE: LeadFact = {
  id: 1,
  name: 'x',
  phone: null,
  status: 'contacted',
  leadSource: null,
  createdAt: null,
  nextFollowUpAt: null,
  lastActivityAt: null,
  lastInboundAt: null,
  lastHumanOutboundAt: null,
  hasOpenTask: false,
  earliestOpenTaskDueAt: null,
}
const fact = (o: Partial<LeadFact> & { id: number }): LeadFact => ({ ...BASE, ...o })

describe('INV-8 business-day bounds (Asia/Jerusalem, single authority)', () => {
  it('dayStart is Israel midnight for a known summer instant', () => {
    expect(CTX.dayStart).toBe(Date.UTC(2026, 6, 19, 21, 0, 0)) // 2026-07-20 00:00 IDT
    expect(CTX.dayEnd).toBe(Date.UTC(2026, 6, 20, 21, 0, 0)) // 2026-07-21 00:00 IDT
    expect(CTX.dayStart).toBeLessThanOrEqual(NOW)
    expect(NOW).toBeLessThan(CTX.dayEnd)
  })

  it('is DST-robust: every day is 23/24/25h and contains its instant', () => {
    for (let d = 0; d < 366; d++) {
      const ms = Date.UTC(2026, 0, 1, 9, 0, 0) + d * D
      const b = businessDayBounds(ms)
      const hours = (b.dayEnd - b.dayStart) / H
      expect([23, 24, 25]).toContain(Math.round(hours))
      expect(b.dayStart).toBeLessThanOrEqual(ms)
      expect(ms).toBeLessThan(b.dayEnd)
    }
  })

  it('dayStart is local midnight of the instant\'s own date, at every hour, on DST-change days too', () => {
    const wall = (ms: number) =>
      new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms))
    const date = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date(ms))
    for (let d = 0; d < 2 * 366; d++) {
      for (const hourUtc of [0, 3, 9, 15, 21, 23]) {
        const ms = Date.UTC(2026, 0, 1, hourUtc, 30, 0) + d * D
        const start = startOfBusinessDayMs(ms)
        expect(wall(start), new Date(ms).toISOString()).toBe('00:00')
        expect(date(start), new Date(ms).toISOString()).toBe(date(ms))
      }
    }
  })

  it('near-midnight classification: 23:30 today vs 00:30 tomorrow', () => {
    const at2330 = startOfBusinessDayMs(NOW) + 23 * H + 30 * 60_000
    const at0030 = CTX.dayEnd + 30 * 60_000
    expect(classifyLead(fact({ id: 1, status: 'new', leadSource: null, nextFollowUpAt: at2330 }), CTX)).toBe(
      'FOLLOWUP_DUE_TODAY',
    )
    expect(classifyLead(fact({ id: 2, nextFollowUpAt: at0030 }), CTX)).toBeNull() // tomorrow → excluded
  })
})

describe('INV-16 / Amendment C-1: inbound-only new (prefix match)', () => {
  it.each([
    ['whatsapp:abc', 'NEW_INBOUND'],
    ['facebook:123', 'NEW_INBOUND'],
    ['manual', null],
    ['instagram', null],
    [null, null],
  ])('new lead leadSource=%s → %s', (leadSource, expected) => {
    expect(classifyLead(fact({ id: 1, status: 'new', leadSource: leadSource as string | null }), CTX)).toBe(expected)
  })

  it('isInboundSource matches only ingested channel prefixes', () => {
    expect(isInboundSource('whatsapp:x')).toBe(true)
    expect(isInboundSource('facebook:x')).toBe(true)
    expect(isInboundSource('whatsappx')).toBe(false)
    expect(isInboundSource(null)).toBe(false)
  })
})

describe('INV-11 / Amendment C-2: waiting cleared only by human outbound', () => {
  const inboundAt = NOW - 2 * H
  it('inbound with no human outbound → WAITING_REPLY', () => {
    expect(classifyLead(fact({ id: 1, lastInboundAt: inboundAt }), CTX)).toBe('WAITING_REPLY')
  })
  it('human outbound after inbound → not waiting', () => {
    expect(
      classifyLead(fact({ id: 1, lastInboundAt: inboundAt, lastHumanOutboundAt: inboundAt + H }), CTX),
    ).not.toBe('WAITING_REPLY')
  })
  it('automated-only reply (no human outbound recorded) → still WAITING_REPLY', () => {
    // facts layer sets lastHumanOutboundAt = null for auto_response sends
    expect(classifyLead(fact({ id: 1, lastInboundAt: inboundAt, lastHumanOutboundAt: null }), CTX)).toBe('WAITING_REPLY')
  })
  it('inbound older than recency window → not waiting', () => {
    expect(classifyLead(fact({ id: 1, lastInboundAt: NOW - 15 * D }), CTX)).not.toBe('WAITING_REPLY')
  })
})

describe('INV-3 exclusions', () => {
  it('terminal wins over any signal', () => {
    expect(classifyLead(fact({ id: 1, status: 'closed', nextFollowUpAt: NOW - 5 * D }), CTX)).toBeNull()
    expect(classifyLead(fact({ id: 2, status: 'lost', lastInboundAt: NOW - H }), CTX)).toBeNull()
  })
  it('future follow-up and healthy-within-SLA excluded', () => {
    expect(classifyLead(fact({ id: 1, nextFollowUpAt: CTX.dayEnd + D }), CTX)).toBeNull()
    expect(classifyLead(fact({ id: 2, status: 'contacted', lastActivityAt: NOW - 2 * H }), CTX)).toBeNull()
  })
})

describe('INV-4 open-loop SLA', () => {
  it.each([
    ['contacted', 25, 'OPEN_LOOP_SLA'],
    ['contacted', 23, null],
    ['interested', 73, 'OPEN_LOOP_SLA'],
    ['interested', 71, null],
  ])('%s aged %ih → %s', (status, hours, expected) => {
    expect(classifyLead(fact({ id: 1, status, lastActivityAt: NOW - hours * H }), CTX)).toBe(expected)
  })
  it('beyond stale ceiling → cold → excluded', () => {
    expect(classifyLead(fact({ id: 1, status: 'contacted', lastActivityAt: NOW - 15 * D }), CTX)).toBeNull()
  })
  it('with a future next step → excluded (loop not open)', () => {
    expect(
      classifyLead(fact({ id: 1, status: 'contacted', lastActivityAt: NOW - 25 * H, nextFollowUpAt: CTX.dayEnd + D }), CTX),
    ).toBeNull()
  })
  it('overdue task outranks open-loop', () => {
    expect(
      classifyLead(
        fact({ id: 1, status: 'contacted', lastActivityAt: NOW - 25 * H, hasOpenTask: true, earliestOpenTaskDueAt: NOW - 2 * D }),
        CTX,
      ),
    ).toBe('OVERDUE_TASK')
  })
  it('a future open task blocks open-loop and is not overdue', () => {
    expect(
      classifyLead(
        fact({ id: 1, status: 'contacted', lastActivityAt: NOW - 25 * H, hasOpenTask: true, earliestOpenTaskDueAt: CTX.dayEnd + D }),
        CTX,
      ),
    ).toBeNull()
  })
})

describe('INV-1 / INV-7 priority, dedup, ordering', () => {
  it('multi-match lead gets highest-priority state', () => {
    // waiting + overdue follow-up → WAITING_REPLY
    expect(classifyLead(fact({ id: 1, lastInboundAt: NOW - H, nextFollowUpAt: NOW - 5 * D }), CTX)).toBe('WAITING_REPLY')
  })
  it('follow-up overdue vs due-today boundary', () => {
    expect(classifyLead(fact({ id: 1, nextFollowUpAt: CTX.dayStart - 1 }), CTX)).toBe('FOLLOWUP_OVERDUE')
    expect(classifyLead(fact({ id: 2, nextFollowUpAt: CTX.dayStart }), CTX)).toBe('FOLLOWUP_DUE_TODAY')
  })
  it('orders by priority; items[0] is highest; each id once', () => {
    const facts = [
      fact({ id: 10, status: 'contacted', lastActivityAt: NOW - 30 * H }), // OPEN_LOOP_SLA
      fact({ id: 11, lastInboundAt: NOW - H }), // WAITING_REPLY
      fact({ id: 12, status: 'new', leadSource: 'whatsapp:z', createdAt: NOW - D }), // NEW_INBOUND
      fact({ id: 11, lastInboundAt: NOW - H }), // duplicate id
    ]
    const items = orderAndDedupe(facts, CTX)
    expect(items.map((i) => i.state)).toEqual(['WAITING_REPLY', 'NEW_INBOUND', 'OPEN_LOOP_SLA'])
    expect(items[0].id).toBe(11)
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length) // no dup ids
    expect(targetSurfaceFor('WAITING_REPLY')).toBe('inbox')
    expect(targetSurfaceFor('NEW_INBOUND')).toBe('lead')
  })
  it('same-state deterministic tiebreak (most overdue first)', () => {
    const items = orderAndDedupe(
      [fact({ id: 1, nextFollowUpAt: NOW - 2 * D }), fact({ id: 2, nextFollowUpAt: NOW - 5 * D })],
      CTX,
    )
    expect(items.map((i) => i.id)).toEqual([2, 1]) // id 2 more overdue → first
  })
})

describe('INV-6 determinism', () => {
  const facts = [
    fact({ id: 3, lastInboundAt: NOW - H }),
    fact({ id: 1, nextFollowUpAt: NOW - 5 * D }),
    fact({ id: 2, status: 'new', leadSource: 'facebook:1', createdAt: NOW - D }),
  ]
  it('identical output twice; invariant to input order', () => {
    const a = orderAndDedupe(facts, CTX)
    const b = orderAndDedupe([...facts].reverse(), CTX)
    expect(a).toEqual(orderAndDedupe(facts, CTX))
    expect(a).toEqual(b)
  })
})

describe('INV-9 / INV-10 completeness verdict', () => {
  it.each([
    [0, true, 'covered', 'scoped_all_clear'],
    [0, false, 'unconfirmed', 'scoped_partial'],
    [5, true, 'active', 'scoped_partial'],
    [5, false, 'active', 'scoped_partial'],
  ])('remaining=%i fresh=%s', (remaining, dataFresh, sv, pv) => {
    expect(completenessVerdict({ remaining: remaining as number, dataFresh: dataFresh as boolean })).toEqual({
      statusVerdict: sv,
      permissionVerdict: pv,
    })
  })
  it('permissionVerdict is always channel-scoped (no unscoped value)', () => {
    const allowed: PermissionVerdict[] = ['scoped_all_clear', 'scoped_partial']
    for (const r of [0, 1, 50]) {
      for (const f of [true, false]) {
        expect(allowed).toContain(completenessVerdict({ remaining: r, dataFresh: f }).permissionVerdict)
      }
    }
  })
})

describe('INV-12 / INV-13 progress', () => {
  it('handled excludes still-qualifying (touched-but-not-done)', () => {
    expect(progress({ qualifyingIds: [1, 2, 3], touchedTodayIds: [3, 4, 5] })).toEqual({
      remaining: 3,
      handledToday: 2, // 4,5 handled; 3 still qualifying → not handled
      done: false,
    })
  })
  it('empty qualifying → done; duplicate touched counted once', () => {
    expect(progress({ qualifyingIds: [], touchedTodayIds: [1, 1] })).toEqual({
      remaining: 0,
      handledToday: 1,
      done: true,
    })
  })
})

describe('volume state (no cap; honest label)', () => {
  it.each([
    [0, 'clear'],
    [HIGH_VOLUME_THRESHOLD, 'normal'],
    [HIGH_VOLUME_THRESHOLD + 1, 'busy'],
  ])('remaining=%i → %s', (n, expected) => {
    expect(volumeStateFor(n as number)).toBe(expected)
  })
})
