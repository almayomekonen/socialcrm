import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/requireUser', () => { const __ru = vi.fn(); return { requireAgencyUser: __ru, requireProductAccess: __ru } })
vi.mock('@/db/filter', () => ({ getPerms: vi.fn() }))
vi.mock('@/lib/copilot/general/classifyGeneralIntent', () => ({ classifyGeneralIntent: vi.fn() }))
vi.mock('@/db/briefing', () => ({
  getFollowUpsDueToday: vi.fn(),
  getLeadsNotContactedRecently: vi.fn(),
  getNewLeadsThisWeek: vi.fn(),
  getOverdueTaskSummary: vi.fn(),
  getUnreadInboxSummary: vi.fn(),
  getLeadsByName: vi.fn(),
  getNamedLeadById: vi.fn(),
}))
vi.mock('@/db/meetings', () => ({ getTodaysMeetings: vi.fn() }))
vi.mock('@/lib/analytics/track', () => ({ track: vi.fn() }))
vi.mock('@/lib/copilot/featureFlag', () => ({
  isReasonedGeneralEnabledForUser: vi.fn(() => false),
  isSynthesisEnabledForUser: vi.fn(() => false),
}))

import { askGeneralQuestion } from '@/actions/ai/askGeneralQuestion'
import { requireAgencyUser } from '@/lib/requireUser'
import { getPerms } from '@/db/filter'
import { classifyGeneralIntent } from '@/lib/copilot/general/classifyGeneralIntent'
import {
  getFollowUpsDueToday,
  getLeadsNotContactedRecently,
  getNewLeadsThisWeek,
  getOverdueTaskSummary,
  getUnreadInboxSummary,
  getLeadsByName,
} from '@/db/briefing'
import { getTodaysMeetings } from '@/db/meetings'
import { track } from '@/lib/analytics/track'
import { Roles } from '@/types/roles'
import { toConversationState } from '@/lib/copilot/general/conversationState'
import { NOTHING_MORE } from '@/lib/copilot/general/continueConversation'

const emptyList = { total: 0, sample: [] }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAgencyUser).mockResolvedValue({ id: 1, agencyId: 10, role: Roles.AGNT, name: 'דני' } as never)
  vi.mocked(getPerms).mockResolvedValue({ gotPermIds: [1] } as never)
  vi.mocked(getFollowUpsDueToday).mockResolvedValue({ total: 3, sample: [] })
  vi.mocked(getLeadsNotContactedRecently).mockResolvedValue(emptyList)
  vi.mocked(getNewLeadsThisWeek).mockResolvedValue(emptyList)
  vi.mocked(getOverdueTaskSummary).mockResolvedValue(emptyList)
  vi.mocked(getUnreadInboxSummary).mockResolvedValue({ conversations: 0, unread: 0 })
  vi.mocked(getTodaysMeetings).mockResolvedValue([])
  vi.mocked(classifyGeneralIntent).mockResolvedValue({ intent: 'unknown', confidence: 0 })
  vi.mocked(track).mockResolvedValue(undefined)
  vi.mocked(getLeadsByName).mockResolvedValue([])
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
    expect(res).toMatchObject({ kind: 'guide', route: '/settings/integrations?section=whatsapp' })
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

describe('askGeneralQuestion — Phase 1 follow-up and growth', () => {
  it('overview → מה עוד? returns the next unused bucket, not clarify', async () => {
    vi.mocked(getFollowUpsDueToday).mockResolvedValue(emptyList)
    vi.mocked(getUnreadInboxSummary).mockResolvedValue({ conversations: 1, unread: 2 })
    const state = toConversationState({
      kind: 'data',
      intent: 'system.overview',
      payload: { summary: 'היום: 1 שיחות ממתינות · 46 לידים שלא בקשר.' },
    })
    const res = await askGeneralQuestion('מה עוד?', undefined, undefined, state)
    expect(res).toEqual({ kind: 'data', intent: 'inbox.unread', payload: { conversations: 1, unread: 2 } })
    expect(classifyGeneralIntent).not.toHaveBeenCalled()
  })

  it('priority lead → למה? explains that lead', async () => {
    const state = toConversationState({
      kind: 'data',
      intent: 'crm.attention',
      payload: {
        overdue: emptyList,
        dueToday: emptyList,
        stale: {
          total: 46,
          sample: [
            { id: 11, name: 'עדי שרון', status: null },
            { id: 12, name: 'קרן שפירא', status: null },
          ],
        },
      },
    })
    const res = await askGeneralQuestion('למה?', undefined, undefined, state)
    expect(res.kind).toBe('guide')
    if (res.kind !== 'guide') return
    expect(res.answer).toContain('עדי שרון')
    expect(res.answer).toContain('עדיין לא יצרת איתו קשר')
    expect(res.answer).not.toMatch(/₪/)
    expect(classifyGeneralIntent).not.toHaveBeenCalled()
  })

  it('priority lead → מי עוד? returns the next leads, not the winner', async () => {
    const state = toConversationState({
      kind: 'data',
      intent: 'crm.attention',
      payload: {
        overdue: emptyList,
        dueToday: emptyList,
        stale: {
          total: 46,
          sample: [
            { id: 11, name: 'עדי שרון', status: null },
            { id: 12, name: 'קרן שפירא', status: null },
            { id: 13, name: 'דנה זהבי', status: null },
            { id: 14, name: 'הדר נחום', status: null },
          ],
        },
      },
    })
    const res = await askGeneralQuestion('מי עוד?', undefined, undefined, state)
    expect(res.kind).toBe('data')
    if (res.kind !== 'data') return
    const sample = (res.payload as { sample: { id: number; name: string }[] }).sample
    expect(sample.map((r) => r.name)).toEqual(['קרן שפירא', 'דנה זהבי', 'הדר נחום'])
    expect(sample.map((r) => r.id)).not.toContain(11)
  })

  it('growth question is not a revenue fallback and uses CRM facts', async () => {
    vi.mocked(getFollowUpsDueToday).mockResolvedValue(emptyList)
    vi.mocked(getLeadsNotContactedRecently).mockResolvedValue({ total: 46, sample: [] })
    vi.mocked(getUnreadInboxSummary).mockResolvedValue({ conversations: 1, unread: 1 })
    const res = await askGeneralQuestion('מה אני יכול לעשות כדי להרוויח כסף?')
    expect(res.kind).toBe('guide')
    if (res.kind !== 'guide') return
    expect(res.answer).toContain('אין לי נתוני הכנסה')
    expect(res.answer).toContain('46')
    expect(res.answer).not.toMatch(/₪/)
    expect(res.answer).not.toMatch(/%/)
    expect(classifyGeneralIntent).not.toHaveBeenCalled()
  })

  it('כמה כסף עשיתי? keeps the honest revenue limitation', async () => {
    expect(await askGeneralQuestion('כמה כסף עשיתי?')).toEqual({ kind: 'fallback', mode: 'redirect', gap: 'revenue' })
  })

  it('כמה הכנסות היו לי? keeps the honest revenue limitation', async () => {
    expect(await askGeneralQuestion('כמה הכנסות היו לי?')).toEqual({ kind: 'fallback', mode: 'redirect', gap: 'revenue' })
  })

  it('no previous state + מה עוד? keeps clarify', async () => {
    expect(await askGeneralQuestion('מה עוד?')).toEqual({ kind: 'fallback', mode: 'clarify' })
  })

  it('no previous state + למה? keeps clarify', async () => {
    expect(await askGeneralQuestion('למה?')).toEqual({ kind: 'fallback', mode: 'clarify' })
  })

  it('מה לעשות עכשיו? is not a contextual follow-up', async () => {
    vi.mocked(classifyGeneralIntent).mockResolvedValue({ intent: 'unknown', confidence: 0 })
    const res = await askGeneralQuestion('מה לעשות עכשיו?')
    expect(res).toEqual({ kind: 'fallback', mode: 'redirect', gap: null })
    expect(classifyGeneralIntent).toHaveBeenCalled()
  })

  it('מה לעשות עכשיו? with prior attention state is still not a follow-up', async () => {
    vi.mocked(classifyGeneralIntent).mockResolvedValue({ intent: 'unknown', confidence: 0 })
    const state = toConversationState({
      kind: 'data',
      intent: 'crm.attention',
      payload: {
        overdue: emptyList,
        dueToday: emptyList,
        stale: { total: 2, sample: [{ id: 11, name: 'עדי שרון', status: null }] },
      },
    })
    const res = await askGeneralQuestion('מה לעשות עכשיו?', undefined, undefined, state)
    expect(res).toEqual({ kind: 'fallback', mode: 'redirect', gap: null })
    expect(classifyGeneralIntent).toHaveBeenCalled()
  })

  it('explicit intents still route to their data/guide answers', async () => {
    vi.mocked(classifyGeneralIntent).mockResolvedValue({ intent: 'meetings.today', confidence: 0.95 })
    expect(await askGeneralQuestion('פגישות היום')).toEqual({ kind: 'data', intent: 'meetings.today', payload: { meetings: [] } })

    vi.mocked(classifyGeneralIntent).mockResolvedValue({ intent: 'followups.dueToday', confidence: 0.95 })
    expect(await askGeneralQuestion('מי צריך מעקב היום')).toMatchObject({ kind: 'data', intent: 'followups.dueToday' })

    vi.mocked(classifyGeneralIntent).mockResolvedValue({ intent: 'system.overview', confidence: 0.95 })
    const overview = await askGeneralQuestion('מה מצב המערכת')
    expect(overview).toMatchObject({ kind: 'data', intent: 'system.overview' })

    vi.mocked(classifyGeneralIntent).mockResolvedValue({ intent: 'guide.connectWhatsapp', confidence: 0.95 })
    expect(await askGeneralQuestion('איך מחברים וואטסאפ')).toMatchObject({
      kind: 'guide',
      route: '/settings/integrations?section=whatsapp',
    })

    vi.mocked(classifyGeneralIntent).mockResolvedValue({ intent: 'guide.importLeads', confidence: 0.95 })
    expect(await askGeneralQuestion('איך מעלים לידים')).toMatchObject({ kind: 'guide', route: '/leads' })

    vi.mocked(classifyGeneralIntent).mockResolvedValue({ intent: 'guide.addLead', confidence: 0.95 })
    expect(await askGeneralQuestion('איך מוסיפים ליד')).toMatchObject({ kind: 'guide', route: '/leads' })
  })

  it('overview lead list then priority → מי עוד? uses the new ranking, not leaked consumption', async () => {
    const names = [
      { id: 11, name: 'עדי שרון', status: null },
      { id: 12, name: 'קרן שפירא', status: null },
      { id: 13, name: 'דנה זהבי', status: null },
      { id: 14, name: 'הדר נחום', status: null },
    ]
    const listed = toConversationState(
      { kind: 'data', intent: 'leads.notContactedRecently', payload: { total: 46, sample: names } },
      toConversationState({ kind: 'data', intent: 'system.overview', payload: { summary: 'x' } }),
    )
    const priority = toConversationState(
      {
        kind: 'data',
        intent: 'crm.attention',
        payload: { overdue: emptyList, dueToday: emptyList, stale: { total: 46, sample: names } },
      },
      listed,
    )
    const res = await askGeneralQuestion('מי עוד?', undefined, undefined, priority)
    expect(res.kind).toBe('data')
    if (res.kind !== 'data') return
    const sample = (res.payload as { sample: { id: number; name: string }[] }).sample
    expect(sample.map((r) => r.name)).toEqual(['קרן שפירא', 'דנה זהבי', 'הדר נחום'])
    expect(sample.map((r) => r.id)).not.toContain(11)
  })

  it('no previous state + מי עוד? keeps clarify', async () => {
    expect(await askGeneralQuestion('מי עוד?')).toEqual({ kind: 'fallback', mode: 'clarify' })
  })

  it('priority then meetings then מי עוד? does not resurrect the ranking', async () => {
    const priority = toConversationState({
      kind: 'data',
      intent: 'crm.attention',
      payload: {
        overdue: emptyList,
        dueToday: emptyList,
        stale: {
          total: 46,
          sample: [
            { id: 11, name: 'עדי שרון', status: null },
            { id: 12, name: 'קרן שפירא', status: null },
            { id: 13, name: 'דנה זהבי', status: null },
          ],
        },
      },
    })
    vi.mocked(classifyGeneralIntent).mockResolvedValue({ intent: 'meetings.today', confidence: 0.95 })
    const meetings = await askGeneralQuestion('מה המצב של הפגישות היום?', undefined, undefined, priority)
    expect(meetings).toEqual({ kind: 'data', intent: 'meetings.today', payload: { meetings: [] } })

    const afterMeetings = toConversationState(meetings, priority)
    vi.mocked(classifyGeneralIntent).mockResolvedValue({ intent: 'unknown', confidence: 0 })
    const res = await askGeneralQuestion('מי עוד?', undefined, undefined, afterMeetings)
    expect(res).toEqual({ kind: 'fallback', mode: 'clarify' })
    expect(classifyGeneralIntent).toHaveBeenCalled()
    if (res.kind === 'data') {
      const sample = (res.payload as { sample?: { name: string }[] }).sample ?? []
      expect(sample.map((r) => r.name)).not.toEqual(expect.arrayContaining(['קרן שפירא']))
    }
  })

  it('exhausted follow-up does not fall back to curated clarify chips', async () => {
    vi.mocked(getFollowUpsDueToday).mockResolvedValue(emptyList)
    const state = toConversationState({
      kind: 'data',
      intent: 'system.overview',
      payload: { summary: 'הכול תחת שליטה.' },
    })
    const res = await askGeneralQuestion('מה עוד?', undefined, undefined, state)
    expect(res).toEqual({ kind: 'guide', answer: NOTHING_MORE })
  })
})
