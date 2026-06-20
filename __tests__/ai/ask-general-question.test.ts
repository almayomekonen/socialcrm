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
vi.mock('@/lib/copilot/driveIntent', () => ({ detectsDriveIntent: vi.fn(), maybePrefetchDrive: vi.fn() }))

import { askGeneralQuestion } from '@/actions/ai/askGeneralQuestion'
import { requireAgencyUser } from '@/lib/requireUser'
import { getPerms } from '@/db/filter'
import { classifyGeneralIntent } from '@/lib/copilot/general/classifyGeneralIntent'
import { getFollowUpsDueToday } from '@/db/briefing'
import { track } from '@/lib/analytics/track'
import { detectsDriveIntent, maybePrefetchDrive } from '@/lib/copilot/driveIntent'
import { Roles } from '@/types/roles'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAgencyUser).mockResolvedValue({ id: 1, agencyId: 10, role: Roles.AGNT, name: 'דני' } as never)
  vi.mocked(getPerms).mockResolvedValue({ gotPermIds: [1] } as never)
  vi.mocked(getFollowUpsDueToday).mockResolvedValue({ total: 3, sample: [] })
  vi.mocked(track).mockResolvedValue(undefined)
  // Default: not a Drive query, so cases fall through to classification.
  vi.mocked(detectsDriveIntent).mockReturnValue(false)
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

  it('Drive search → deterministic file list (user-scoped, no classification)', async () => {
    vi.mocked(detectsDriveIntent).mockReturnValue(true)
    vi.mocked(maybePrefetchDrive).mockResolvedValue({
      mode: 'specific',
      readIntent: false,
      results: [
        { id: 'f1', name: 'הצעת מחיר.pdf', mimeType: 'application/pdf', modifiedTime: '2026-06-01T00:00:00Z', webViewLink: 'https://drive/f1', thumbnailLink: null },
      ],
    } as never)
    const res = await askGeneralQuestion('מצא קובץ ב-Google Drive')
    expect(res.kind).toBe('drive')
    if (res.kind !== 'drive') return
    expect(res.data.results).toEqual([
      { id: 'f1', name: 'הצעת מחיר.pdf', mimeType: 'application/pdf', modifiedTime: '2026-06-01T00:00:00Z', url: 'https://drive/f1', thumbnailUrl: undefined },
    ])
    expect(classifyGeneralIntent).not.toHaveBeenCalled()
  })

  it('Drive intent but unavailable → empty results + connect hint (no crash)', async () => {
    vi.mocked(detectsDriveIntent).mockReturnValue(true)
    vi.mocked(maybePrefetchDrive).mockResolvedValue(null)
    const res = await askGeneralQuestion('חפש קובץ ב-Drive')
    expect(res.kind).toBe('drive')
    if (res.kind !== 'drive') return
    expect(res.data.results).toEqual([])
    expect(res.data.intro).toContain('חיברת את החשבון')
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
