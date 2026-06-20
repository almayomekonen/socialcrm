import { vi, describe, it, expect, beforeEach } from 'vitest'

// All data/auth deps mocked → pure unit test of the assembly + deterministic
// greeting + ordering. No DB, no model.
vi.mock('@/lib/requireUser', () => ({ requireAgencyUser: vi.fn() }))
vi.mock('@/db/filter', () => ({ getPerms: vi.fn() }))
vi.mock('@/db/clients', () => ({ hasAnyLeads: vi.fn() }))
vi.mock('@/db/meetings', () => ({ getTodaysMeetings: vi.fn() }))
vi.mock('@/db/briefing', () => ({
  getFollowUpsDueToday: vi.fn(),
  getLeadsNotContactedRecently: vi.fn(),
  getNewLeadsThisWeek: vi.fn(),
  getOverdueTaskSummary: vi.fn(),
  getUnreadInboxSummary: vi.fn(),
  getPromisedButWaiting: vi.fn(async () => ({ total: 0, sample: [] })),
}))
vi.mock('@/lib/analytics/track', () => ({ track: vi.fn() }))

import { getDailyBriefing } from '@/actions/ai/getDailyBriefing'
import { requireAgencyUser } from '@/lib/requireUser'
import { getPerms } from '@/db/filter'
import { hasAnyLeads } from '@/db/clients'
import { getTodaysMeetings } from '@/db/meetings'
import {
  getFollowUpsDueToday,
  getLeadsNotContactedRecently,
  getNewLeadsThisWeek,
  getOverdueTaskSummary,
  getUnreadInboxSummary,
} from '@/db/briefing'
import { Roles } from '@/types/roles'

const list = (total: number) => ({ total, sample: [] })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAgencyUser).mockResolvedValue({ id: 1, agencyId: 10, role: Roles.AGNT, name: 'דני' } as never)
  vi.mocked(getPerms).mockResolvedValue({ gotPermIds: [1] } as never)
  vi.mocked(getFollowUpsDueToday).mockResolvedValue(list(3))
  vi.mocked(getLeadsNotContactedRecently).mockResolvedValue(list(5))
  vi.mocked(getNewLeadsThisWeek).mockResolvedValue(list(2))
  vi.mocked(getOverdueTaskSummary).mockResolvedValue(list(4))
  vi.mocked(getUnreadInboxSummary).mockResolvedValue({ conversations: 2, unread: 7 })
  vi.mocked(getTodaysMeetings).mockResolvedValue([{ id: 9, title: 'שיחה', startAt: 'x', leadName: 'רותי' }] as never)
})

describe('getDailyBriefing', () => {
  it('returns the empty-state when the user has no leads', async () => {
    vi.mocked(hasAnyLeads).mockResolvedValue(false)
    const res = await getDailyBriefing()
    expect(res).toEqual({ kind: 'empty' })
  })

  it('assembles six sections in urgency-first order with true totals', async () => {
    vi.mocked(hasAnyLeads).mockResolvedValue(true)
    const res = await getDailyBriefing()
    expect(res.kind).toBe('briefing')
    if (res.kind !== 'briefing') return
    expect(res.sections.map((s) => s.id)).toEqual([
      'tasks.overdue',
      'followups.dueToday',
      'meetings.today',
      'inbox.unread',
      'leads.notContactedRecently',
      'leads.newThisWeek',
    ])
  })

  it('builds a deterministic greeting from the real counts (no model call)', async () => {
    vi.mocked(hasAnyLeads).mockResolvedValue(true)
    const res = await getDailyBriefing()
    if (res.kind !== 'briefing') throw new Error('expected briefing')
    expect(res.greeting).toBe('היום: 4 משימות באיחור · 3 מעקבים להיום · 1 פגישות · 7 הודעות שלא נקראו.')
  })

  it('falls back to a calm sentence when nothing is urgent', async () => {
    vi.mocked(hasAnyLeads).mockResolvedValue(true)
    vi.mocked(getFollowUpsDueToday).mockResolvedValue(list(0))
    vi.mocked(getOverdueTaskSummary).mockResolvedValue(list(0))
    vi.mocked(getUnreadInboxSummary).mockResolvedValue({ conversations: 0, unread: 0 })
    vi.mocked(getTodaysMeetings).mockResolvedValue([] as never)
    const res = await getDailyBriefing()
    if (res.kind !== 'briefing') throw new Error('expected briefing')
    expect(res.greeting).toContain('אין משימות דחופות')
  })

  it('degrades a single failing reader but still returns the briefing', async () => {
    vi.mocked(hasAnyLeads).mockResolvedValue(true)
    vi.mocked(getOverdueTaskSummary).mockRejectedValue(new Error('db blip'))
    const res = await getDailyBriefing()
    if (res.kind !== 'briefing') throw new Error('expected briefing')
    const overdue = res.sections.find((s) => s.id === 'tasks.overdue')
    expect(overdue).toMatchObject({ total: 0 })
  })
})
