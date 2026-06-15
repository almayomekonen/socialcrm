import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/requireUser', () => ({ requireAgencyUser: vi.fn() }))
vi.mock('@/db/filter', () => ({ getPerms: vi.fn() }))
vi.mock('@/lib/copilot/general/classifyGeneralIntent', () => ({ classifyGeneralIntent: vi.fn() }))
vi.mock('@/db/briefing', () => ({
  getFollowUpsDueToday: vi.fn(),
  getLeadsNotContactedRecently: vi.fn(),
  getNewLeadsThisWeek: vi.fn(),
  getOverdueTaskSummary: vi.fn(),
  getUnreadInboxSummary: vi.fn(),
}))
vi.mock('@/db/meetings', () => ({ getTodaysMeetings: vi.fn() }))
vi.mock('@/lib/analytics/track', () => ({ track: vi.fn() }))

import { askGeneralQuestion } from '@/actions/ai/askGeneralQuestion'
import { requireAgencyUser } from '@/lib/requireUser'
import { getPerms } from '@/db/filter'
import { classifyGeneralIntent } from '@/lib/copilot/general/classifyGeneralIntent'
import { getFollowUpsDueToday } from '@/db/briefing'
import { track } from '@/lib/analytics/track'
import { Roles } from '@/types/roles'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAgencyUser).mockResolvedValue({ id: 1, agencyId: 10, role: Roles.AGNT, name: 'דני' } as never)
  vi.mocked(getPerms).mockResolvedValue({ gotPermIds: [1] } as never)
  vi.mocked(getFollowUpsDueToday).mockResolvedValue({ total: 3, sample: [] })
  vi.mocked(track).mockResolvedValue(undefined)
})

describe('askGeneralQuestion — closed world', () => {
  it('out-of-set / unknown → capability menu', async () => {
    vi.mocked(classifyGeneralIntent).mockResolvedValue({ intent: 'unknown', confidence: 0 })
    expect(await askGeneralQuestion('כמה עולה ביטקוין')).toEqual({ kind: 'menu', reason: 'unknown' })
  })

  it('low confidence → capability menu (no guess)', async () => {
    vi.mocked(classifyGeneralIntent).mockResolvedValue({ intent: 'tasks.overdue', confidence: 0.4 })
    expect(await askGeneralQuestion('משהו מעורפל')).toEqual({ kind: 'menu', reason: 'low-confidence' })
  })

  it('guide intent → authored answer + route', async () => {
    vi.mocked(classifyGeneralIntent).mockResolvedValue({ intent: 'guide.connectWhatsapp', confidence: 0.95 })
    const res = await askGeneralQuestion('איך מחברים וואטסאפ')
    expect(res).toMatchObject({ kind: 'guide', route: '/settings/facebook' })
  })

  it('data intent → deterministic payload', async () => {
    vi.mocked(classifyGeneralIntent).mockResolvedValue({ intent: 'followups.dueToday', confidence: 0.95 })
    const res = await askGeneralQuestion('מי צריך מעקב היום')
    expect(res).toEqual({ kind: 'data', intent: 'followups.dueToday', payload: { total: 3, sample: [] } })
  })

  it('SAFEGUARD: analytics throwing does NOT affect the answer', async () => {
    vi.mocked(classifyGeneralIntent).mockResolvedValue({ intent: 'followups.dueToday', confidence: 0.95 })
    vi.mocked(track).mockRejectedValue(new Error('analytics down'))
    const res = await askGeneralQuestion('מי צריך מעקב היום')
    expect(res).toEqual({ kind: 'data', intent: 'followups.dueToday', payload: { total: 3, sample: [] } })
  })
})
