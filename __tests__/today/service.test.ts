import { beforeEach, describe, expect, it, vi } from 'vitest'

// Service composition tests — no DB. The db layer is mocked and fed LeadFact
// fixtures, so buildTodayBrief's assembly (classify → progress → verdict → DTO) is
// exercised deterministically. Covers regression matrix A(bounds)/B(freshness)/
// F(volume)/G(progress)/H(dedup), INV-2 (no cap), INV-14 (meetings neutral),
// and the DTO contract. Scope (INV-5) and human-vs-auto (INV-11) live at the
// facts layer and are covered by facts.sql.test.ts.

vi.mock('@/db/today/facts', () => ({ getBriefCandidateFacts: vi.fn() }))
vi.mock('@/db/today/handled', () => ({ getTouchedTodayIds: vi.fn() }))
vi.mock('@/db/today/freshness', () => ({ getInboundSyncFreshness: vi.fn() }))
vi.mock('@/db/meetings', () => ({ getTodaysMeetings: vi.fn() }))
vi.mock('@/db/inboxWaiting', () => ({ listOldestWaitingWhatsappByLeadIds: vi.fn() }))

import { buildTodayBrief, type Viewer } from '@/lib/today/service'
import { getBriefCandidateFacts } from '@/db/today/facts'
import { getTouchedTodayIds } from '@/db/today/handled'
import { getInboundSyncFreshness } from '@/db/today/freshness'
import { getTodaysMeetings } from '@/db/meetings'
import { listOldestWaitingWhatsappByLeadIds } from '@/db/inboxWaiting'
import { businessDayBounds } from '@/lib/today/time'
import type { LeadFact } from '@/lib/today/types'

const D = 86_400_000
const NOW = Date.UTC(2026, 6, 20, 9, 0, 0)
const CTX = businessDayBounds(NOW)
const VIEWER: Viewer = { scope: { user: { role: 'ADMIN' as never }, gotPermIds: [] }, agencyId: 1, userId: 1, firstName: 'ד' }

const BASE: LeadFact = {
  id: 0,
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
const overdue = (id: number): LeadFact => ({ ...BASE, id, nextFollowUpAt: NOW - 5 * D })

function setup(opts: { facts?: LeadFact[]; touched?: number[]; dataFresh?: boolean; meetings?: unknown[] } = {}) {
  vi.mocked(getBriefCandidateFacts).mockResolvedValue(opts.facts ?? [])
  vi.mocked(getTouchedTodayIds).mockResolvedValue(opts.touched ?? [])
  vi.mocked(getInboundSyncFreshness).mockResolvedValue({ dataFresh: opts.dataFresh ?? false })
  vi.mocked(getTodaysMeetings).mockResolvedValue((opts.meetings ?? []) as never)
  vi.mocked(listOldestWaitingWhatsappByLeadIds).mockResolvedValue([])
}

beforeEach(() => vi.clearAllMocks())

describe('buildTodayBrief composition', () => {
  it('empty + fresh → covered / all-clear / done / clear', async () => {
    setup({ facts: [], dataFresh: true })
    const b = await buildTodayBrief(VIEWER, NOW)
    expect(b).toMatchObject({
      total: 0,
      remaining: 0,
      done: true,
      volumeState: 'clear',
      statusVerdict: 'covered',
      permissionVerdict: 'scoped_all_clear',
    })
  })

  it('B: not fresh → never covered (unconfirmed / scoped_partial)', async () => {
    setup({ facts: [], dataFresh: false })
    const b = await buildTodayBrief(VIEWER, NOW)
    expect(b.statusVerdict).toBe('unconfirmed')
    expect(b.permissionVerdict).toBe('scoped_partial')
  })

  it('INV-2 / F: no cap — 13 qualifying → total 13, busy', async () => {
    setup({ facts: Array.from({ length: 13 }, (_, i) => overdue(i + 1)), dataFresh: true })
    const b = await buildTodayBrief(VIEWER, NOW)
    expect(b.total).toBe(13)
    expect(b.remaining).toBe(13)
    expect(b.items).toHaveLength(13)
    expect(b.volumeState).toBe('busy')
    expect(b.statusVerdict).toBe('active')
  })

  it('H: dedup — duplicate id counted once', async () => {
    setup({ facts: [overdue(1), overdue(1), overdue(2)] })
    const b = await buildTodayBrief(VIEWER, NOW)
    expect(b.total).toBe(2)
    expect(new Set(b.items.map((i) => i.id)).size).toBe(2)
  })

  it('G: handled excludes still-qualifying', async () => {
    setup({ facts: [overdue(1), overdue(2)], touched: [2, 3] })
    const b = await buildTodayBrief(VIEWER, NOW)
    expect(b).toMatchObject({ remaining: 2, handledToday: 1, done: false }) // id 3 handled; 2 still qualifying
  })

  it('meetings carry a server-formatted HH:mm label in Asia/Jerusalem, across DST', async () => {
    setup({
      facts: [],
      dataFresh: true,
      meetings: [
        { id: 1, title: 'IDT', start_at: new Date(Date.UTC(2026, 9, 22, 7, 30)) }, // UTC+3
        { id: 2, title: 'IST', start_at: '2026-12-01T06:05:00Z' }, // UTC+2
        { id: 3, title: 'bad', start_at: 'not-a-date' },
      ],
    })
    const b = await buildTodayBrief(VIEWER, NOW)
    expect(b.meetings.map((m) => m.timeLabel)).toEqual(['10:30', '08:05', null])
    expect(b.meetings[2].at).toBe(0)
  })

  it('INV-14: meetings never affect remaining/handled/done', async () => {
    setup({ facts: [], dataFresh: true, meetings: [{ id: 9, title: 'M', start_at: new Date(NOW) }] })
    const b = await buildTodayBrief(VIEWER, NOW)
    expect(b.meetings).toHaveLength(1)
    expect(b).toMatchObject({ remaining: 0, handledToday: 0, done: true })
  })

  it('contract: DTO exposes only the agreed fields (no filter/sort/page)', async () => {
    setup({ facts: [overdue(1)] })
    const b = await buildTodayBrief(VIEWER, NOW)
    expect(Object.keys(b).sort()).toEqual(
      ['done', 'firstName', 'greeting', 'handledToday', 'items', 'meetings', 'permissionVerdict', 'remaining', 'statusVerdict', 'total', 'volumeState'].sort(),
    )
    void CTX
  })

  it('WAITING_REPLY hydrates the exact conversation deep link', async () => {
    setup({
      facts: [{ ...BASE, id: 4, name: 'דנה', lastInboundAt: NOW - 7 * 3_600_000, lastHumanOutboundAt: null }],
    })
    vi.mocked(listOldestWaitingWhatsappByLeadIds).mockResolvedValue([
      {
        conversationId: 88,
        leadId: 4,
        name: 'דנה',
        phone: '050',
        status: 'contacted',
        lastInboundAt: new Date(NOW - 7 * 3_600_000).toISOString(),
        lastHumanOutboundAt: null,
      },
    ])
    const b = await buildTodayBrief(VIEWER, NOW)
    expect(b.items[0].state).toBe('WAITING_REPLY')
    expect(b.items[0].conversationId).toBe(88)
    expect(b.items[0].href).toBe('/inbox?conversation=88')
    expect(b.items[0].waitingFor).toBe('ממתין 7 שעות')
  })
})
