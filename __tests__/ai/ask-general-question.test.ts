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
  it('out-of-set / unknown → redirect fallback', async () => {
    vi.mocked(classifyGeneralIntent).mockResolvedValue({ intent: 'unknown', confidence: 0 })
    expect(await askGeneralQuestion('כמה עולה ביטקוין')).toEqual({ kind: 'fallback', mode: 'redirect', gap: null })
  })

  it('low confidence → redirect fallback (no guess)', async () => {
    vi.mocked(classifyGeneralIntent).mockResolvedValue({ intent: 'tasks.overdue', confidence: 0.4 })
    expect(await askGeneralQuestion('משהו מעורפל')).toEqual({ kind: 'fallback', mode: 'redirect', gap: null })
  })

  it('known gap (results) → intercepted BEFORE the classifier', async () => {
    const res = await askGeneralQuestion('כמה סגרתי החודש?')
    expect(res).toEqual({ kind: 'fallback', mode: 'redirect', gap: 'results' })
    expect(classifyGeneralIntent).not.toHaveBeenCalled()
  })

  it('known gap (revenue) → intercepted BEFORE the classifier', async () => {
    const res = await askGeneralQuestion('כמה כסף עשיתי?')
    expect(res).toEqual({ kind: 'fallback', mode: 'redirect', gap: 'revenue' })
    expect(classifyGeneralIntent).not.toHaveBeenCalled()
  })

  it('known gap (source) → intercepted BEFORE the classifier', async () => {
    const res = await askGeneralQuestion('מאיזה מקור מגיעים הלידים הכי טובים?')
    expect(res).toEqual({ kind: 'fallback', mode: 'redirect', gap: 'source' })
    expect(classifyGeneralIntent).not.toHaveBeenCalled()
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

  it('threads the selected AI mode into classification', async () => {
    vi.mocked(classifyGeneralIntent).mockResolvedValue({ intent: 'followups.dueToday', confidence: 0.95 })
    await askGeneralQuestion('מי צריך מעקב היום', 'advanced')
    expect(classifyGeneralIntent).toHaveBeenCalledWith('מי צריך מעקב היום', 10, 'advanced')
  })

  it('ignores an invalid mode (falls back to default tier)', async () => {
    vi.mocked(classifyGeneralIntent).mockResolvedValue({ intent: 'followups.dueToday', confidence: 0.95 })
    await askGeneralQuestion('מי צריך מעקב היום', 'nonsense')
    expect(classifyGeneralIntent).toHaveBeenCalledWith('מי צריך מעקב היום', 10, undefined)
  })

  it('SAFEGUARD: analytics throwing does NOT affect the answer', async () => {
    vi.mocked(classifyGeneralIntent).mockResolvedValue({ intent: 'followups.dueToday', confidence: 0.95 })
    vi.mocked(track).mockRejectedValue(new Error('analytics down'))
    const res = await askGeneralQuestion('מי צריך מעקב היום')
    expect(res).toEqual({ kind: 'data', intent: 'followups.dueToday', payload: { total: 3, sample: [] } })
  })
})
