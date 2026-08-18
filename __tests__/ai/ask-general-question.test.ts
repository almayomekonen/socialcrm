import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/requireUser', () => { const __ru = vi.fn(); return { requireAgencyUser: __ru, requireProductAccess: __ru } })
vi.mock('@/db/filter', () => ({ getPerms: vi.fn() }))
vi.mock('@/lib/copilot/general/classifyGeneralIntent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/copilot/general/classifyGeneralIntent')>()
  return { ...actual, classifyGeneralIntent: vi.fn() }
})
vi.mock('@/lib/copilot/general/recentInbound', () => ({
  loadRecentInboundWhatsapp: vi.fn(),
  loadWaitingInboundWhatsapp: vi.fn(),
}))
vi.mock('@/lib/copilot/general/waitingInbound', () => ({ listWaitingWhatsappLeads: vi.fn() }))
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
import { loadRecentInboundWhatsapp, loadWaitingInboundWhatsapp } from '@/lib/copilot/general/recentInbound'
import { listWaitingWhatsappLeads } from '@/lib/copilot/general/waitingInbound'
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
import { isReasonedGeneralEnabledForUser } from '@/lib/copilot/featureFlag'
import { toConversationState } from '@/lib/copilot/general/conversationState'
import { NOTHING_MORE, NO_MORE_LEADS } from '@/lib/copilot/general/continueConversation'

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
  vi.mocked(loadRecentInboundWhatsapp).mockResolvedValue({ senders: [], answer: 'אין כרגע הודעות וואטסאפ נכנסות לאחרונה.' })
  vi.mocked(loadWaitingInboundWhatsapp).mockResolvedValue({ senders: [], answer: 'אין כרגע שיחות וואטסאפ שממתינות למענה.' })
  vi.mocked(listWaitingWhatsappLeads).mockResolvedValue(emptyList)
  vi.mocked(isReasonedGeneralEnabledForUser).mockReturnValue(false)
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
    await askGeneralQuestion('משימות שצריך לסגור כבר מזמן', 'advanced')
    expect(classifyGeneralIntent).toHaveBeenCalledWith('משימות שצריך לסגור כבר מזמן', 10, 'advanced')
  })

  it('ignores an invalid mode (falls back to default tier)', async () => {
    vi.mocked(classifyGeneralIntent).mockResolvedValue({ intent: 'followups.dueToday', confidence: 0.95 })
    await askGeneralQuestion('משימות שצריך לסגור כבר מזמן', 'nonsense')
    expect(classifyGeneralIntent).toHaveBeenCalledWith('משימות שצריך לסגור כבר מזמן', 10, undefined)
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
    expect(res.kind).toBe('data')
    if (res.kind !== 'data') return
    expect(res.intent).toBe('business.advice')
    const summary = (res.payload as { summary: string }).summary
    expect(summary).toContain('אין לי נתוני הכנסה')
    expect(summary).toContain('46')
    expect(summary).not.toMatch(/₪/)
    expect(summary).not.toMatch(/%/)
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

  it('priority then פגישות היום then מי עוד? does not resurrect the ranking', async () => {
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
    const meetings = await askGeneralQuestion('פגישות היום', undefined, undefined, priority)
    expect(meetings).toEqual({ kind: 'data', intent: 'meetings.today', payload: { meetings: [] } })

    const afterMeetings = toConversationState(meetings, priority)
    vi.mocked(classifyGeneralIntent).mockResolvedValue({ intent: 'unknown', confidence: 0 })
    const res = await askGeneralQuestion('מי עוד?', undefined, undefined, afterMeetings)
    expect(res).toEqual({ kind: 'fallback', mode: 'clarify' })
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

describe('askGeneralQuestion — grounded Business Copilot answers', () => {
  function summaryOf(res: Awaited<ReturnType<typeof askGeneralQuestion>>): string {
    if (res.kind === 'data' && res.payload && typeof res.payload === 'object' && 'summary' in res.payload) {
      return String((res.payload as { summary: string }).summary)
    }
    if (res.kind === 'guide') return res.answer
    if (res.kind === 'data' && res.payload && typeof res.payload === 'object' && 'answer' in res.payload) {
      return String((res.payload as { answer: string }).answer)
    }
    return JSON.stringify(res)
  }

  it('A. מה מצב העסק? is evidence-backed interpretation, not a raw dump', async () => {
    vi.mocked(getLeadsNotContactedRecently).mockResolvedValue({ total: 42, sample: [] })
    vi.mocked(getUnreadInboxSummary).mockResolvedValue({ conversations: 1, unread: 1 })
    const res = await askGeneralQuestion('מה מצב העסק?')
    expect(res).toMatchObject({ kind: 'data', intent: 'business.advice' })
    const text = summaryOf(res)
    expect(text).toContain('42')
    expect(text).not.toMatch(/^היום: /)
    expect(text).not.toContain('סיכוי גבוה')
    expect(text).not.toMatch(/₪/)
    expect(classifyGeneralIntent).not.toHaveBeenCalled()
  })

  it('B. מה אני יכול לעשות כדי לקדם את העסק? is a prioritized recommendation', async () => {
    vi.mocked(isReasonedGeneralEnabledForUser).mockReturnValue(true)
    vi.mocked(getLeadsNotContactedRecently).mockResolvedValue({ total: 42, sample: [] })
    vi.mocked(getUnreadInboxSummary).mockResolvedValue({ conversations: 1, unread: 1 })
    const res = await askGeneralQuestion('מה אני יכול לעשות כדי לקדם את העסק?')
    expect(res).toMatchObject({ kind: 'data', intent: 'business.advice' })
    const text = summaryOf(res)
    expect(text).toContain('הייתי מתמקד')
    expect(text).toContain('42')
    expect(text).toContain('אין לי נתוני הכנסה')
    expect(text).not.toMatch(/₪/)
    expect(text).not.toMatch(/%/)
    expect(text).not.toContain('סיכוי גבוה')
    expect(text).not.toContain('יגדיל המרות')
    expect(classifyGeneralIntent).not.toHaveBeenCalled()
  })

  it('C. מה הכי דחוף? ranks with an explainable reason', async () => {
    vi.mocked(listWaitingWhatsappLeads).mockResolvedValue({
      total: 1,
      sample: [{ id: 88, name: 'George', status: null }],
    })
    const res = await askGeneralQuestion('מה הכי דחוף?')
    expect(res).toMatchObject({ kind: 'data', intent: 'crm.attention' })
    const state = toConversationState(res)
    expect(state?.subjectLead?.name).toBe('George')
    expect(state?.reason).toContain('ממתין למענה')
    expect(classifyGeneralIntent).not.toHaveBeenCalled()
  })

  it('D. למה? after priority keeps the same subject and evidence', async () => {
    const state = toConversationState({
      kind: 'data',
      intent: 'crm.attention',
      payload: {
        waiting: { total: 1, sample: [{ id: 88, name: 'George', status: null }] },
        overdue: emptyList,
        dueToday: emptyList,
        stale: emptyList,
      },
    })
    const res = await askGeneralQuestion('למה?', undefined, undefined, state)
    expect(res.kind).toBe('guide')
    if (res.kind !== 'guide') return
    expect(res.answer).toContain('George')
    expect(res.answer).toContain('ממתין למענה')
    expect(res.answer).not.toMatch(/₪/)
  })

  it('E. מה אתה רואה? returns 2–3 observations and no invented KPI', async () => {
    vi.mocked(getLeadsNotContactedRecently).mockResolvedValue({ total: 42, sample: [] })
    vi.mocked(getUnreadInboxSummary).mockResolvedValue({ conversations: 1, unread: 1 })
    vi.mocked(getNewLeadsThisWeek).mockResolvedValue({ total: 40, sample: [] })
    const res = await askGeneralQuestion('מה אתה רואה?')
    expect(res).toMatchObject({ kind: 'data', intent: 'business.advice' })
    const text = summaryOf(res)
    expect(text).toContain('מה שאני רואה כרגע')
    expect(text).toContain('42')
    expect(text).not.toContain('המרה נמוכה')
    expect(text).not.toMatch(/₪/)
  })

  it('F. איפה אני מפסיד לידים? uses CRM evidence or admits insufficient data', async () => {
    vi.mocked(getLeadsNotContactedRecently).mockResolvedValue({ total: 42, sample: [] })
    const withEvidence = await askGeneralQuestion('איפה אני מפסיד לידים?')
    expect(withEvidence).toMatchObject({ kind: 'data', intent: 'business.advice' })
    const leak = summaryOf(withEvidence)
    expect(leak).toContain('42')
    expect(leak).not.toContain('מפסיד כסף')
    expect(leak).not.toMatch(/₪/)

    vi.mocked(getLeadsNotContactedRecently).mockResolvedValue(emptyList)
    vi.mocked(getUnreadInboxSummary).mockResolvedValue({ conversations: 0, unread: 0 })
    vi.mocked(getOverdueTaskSummary).mockResolvedValue(emptyList)
    const insufficient = await askGeneralQuestion('איפה אני מפסיד לידים?')
    expect(summaryOf(insufficient)).toContain('אני לא יכול לקבוע')
  })

  it('G. מי שלח לי הודעה לאחרונה? stays a narrow factual inbound answer', async () => {
    vi.mocked(isReasonedGeneralEnabledForUser).mockReturnValue(true)
    vi.mocked(loadRecentInboundWhatsapp).mockResolvedValue({
      senders: [{ name: 'George', at: '2026-08-18T13:17:00.000Z' }],
      answer: 'מי ששלח הודעה בוואטסאפ לאחרונה:\n• George — לפני 2 דקות',
    })
    const res = await askGeneralQuestion('מי שלח לי הודעה לאחרונה?')
    expect(res).toMatchObject({ kind: 'data', intent: 'inbox.recentInbound' })
    const payload = (res as { payload: { answer: string } }).payload
    expect(payload.answer).toContain('George')
    expect(payload.answer).not.toContain('ממתין')
    expect(payload.answer).not.toMatch(/callback/i)
    expect(res).not.toMatchObject({ intent: 'crm.attention' })
  })

  it('H. מי מחכה לי בוואטסאפ? is waiting, not a recency dump', async () => {
    vi.mocked(loadWaitingInboundWhatsapp).mockResolvedValue({
      senders: [{ name: 'George', at: '2026-08-18T13:17:00.000Z' }],
      answer: 'מי שממתין למענה בוואטסאפ:\n• George — לפני 2 דקות\n\nGeorge עדיין ממתין, אז הצעד הישיר הוא לענות.',
    })
    const res = await askGeneralQuestion('מי מחכה לי בוואטסאפ?')
    expect(res).toMatchObject({ kind: 'data', intent: 'inbox.waiting' })
    const payload = (res as { payload: { answer: string } }).payload
    expect(payload.answer).toContain('ממתין')
    expect(payload.answer).not.toContain('מי ששלח הודעה בוואטסאפ לאחרונה')
    expect(res).not.toMatchObject({ intent: 'crm.attention' })
  })

  it('H2. למי צריך לענות? is waiting inbound', async () => {
    vi.mocked(loadWaitingInboundWhatsapp).mockResolvedValue({
      senders: [{ name: 'George', at: '2026-08-18T13:17:00.000Z' }],
      answer: 'מי שממתין למענה בוואטסאפ:\n• George — לפני 2 דקות',
    })
    const res = await askGeneralQuestion('למי צריך לענות?')
    expect(res).toMatchObject({ kind: 'data', intent: 'inbox.waiting' })
  })

  it('H3. יש הודעות שלא קראתי? is unread, not waiting or recency', async () => {
    vi.mocked(getUnreadInboxSummary).mockResolvedValue({ conversations: 1, unread: 9 })
    const res = await askGeneralQuestion('יש הודעות שלא קראתי?')
    expect(res).toEqual({ kind: 'data', intent: 'inbox.unread', payload: { conversations: 1, unread: 9 } })
  })

  it('I. כמה כסף עשיתי? stays the honest revenue gap', async () => {
    expect(await askGeneralQuestion('כמה כסף עשיתי?')).toEqual({ kind: 'fallback', mode: 'redirect', gap: 'revenue' })
  })

  it('J. Phase 1 regression sequence does not resurrect ranking or repeat leads', async () => {
    vi.mocked(getFollowUpsDueToday).mockResolvedValue(emptyList)
    vi.mocked(getOverdueTaskSummary).mockResolvedValue(emptyList)
    vi.mocked(getLeadsNotContactedRecently).mockResolvedValue(emptyList)
    vi.mocked(getNewLeadsThisWeek).mockResolvedValue(emptyList)
    vi.mocked(getTodaysMeetings).mockResolvedValue([])
    vi.mocked(getUnreadInboxSummary).mockResolvedValue({ conversations: 1, unread: 2 })

    let state = toConversationState({
      kind: 'data',
      intent: 'system.overview',
      payload: { summary: 'היום: 1 שיחות ממתינות.' },
    })
    const more1 = await askGeneralQuestion('מה עוד?', undefined, undefined, state)
    expect(more1).toEqual({ kind: 'data', intent: 'inbox.unread', payload: { conversations: 1, unread: 2 } })
    state = toConversationState(more1, state)

    const more2 = await askGeneralQuestion('מה עוד?', undefined, undefined, state)
    expect(more2).toEqual({ kind: 'guide', answer: NOTHING_MORE })
    state = toConversationState(more2, state)

    const names = [
      { id: 11, name: 'עדי שרון', status: null },
      { id: 12, name: 'קרן שפירא', status: null },
      { id: 13, name: 'דנה זהבי', status: null },
    ]
    vi.mocked(getLeadsNotContactedRecently).mockResolvedValue({ total: 3, sample: names })
    const urgent = await askGeneralQuestion('מי הליד הכי דחוף?')
    expect(urgent).toMatchObject({ kind: 'data', intent: 'crm.attention' })
    state = toConversationState(urgent)

    const why = await askGeneralQuestion('למה?', undefined, undefined, state)
    expect(why.kind).toBe('guide')
    if (why.kind === 'guide') expect(why.answer).toContain('עדי שרון')
    state = toConversationState(why, state)

    const who1 = await askGeneralQuestion('מי עוד?', undefined, undefined, state)
    expect(who1.kind).toBe('data')
    if (who1.kind === 'data') {
      const sample = (who1.payload as { sample: { id: number }[] }).sample
      expect(sample.map((r) => r.id)).toEqual([12, 13])
      expect(sample.map((r) => r.id)).not.toContain(11)
    }
    state = toConversationState(who1, state)

    const who2 = await askGeneralQuestion('מי עוד?', undefined, undefined, state)
    expect(who2).toEqual({ kind: 'guide', answer: NO_MORE_LEADS })
    state = toConversationState(who2, state)

    const meetings = await askGeneralQuestion('פגישות היום', undefined, undefined, state)
    expect(meetings).toEqual({ kind: 'data', intent: 'meetings.today', payload: { meetings: [] } })
    state = toConversationState(meetings, state)

    const whoAfterMeetings = await askGeneralQuestion('מי עוד?', undefined, undefined, state)
    expect(whoAfterMeetings).toEqual({ kind: 'fallback', mode: 'clarify' })

    vi.mocked(getLeadsNotContactedRecently).mockResolvedValue({ total: 42, sample: [] })
    const growth = await askGeneralQuestion('מה אני יכול לעשות כדי לקדם את העסק?', undefined, undefined, state)
    expect(growth).toMatchObject({ kind: 'data', intent: 'business.advice' })
    state = toConversationState(growth, state)

    const moreAfterGrowth = await askGeneralQuestion('מה עוד?', undefined, undefined, state)
    expect(moreAfterGrowth.kind).not.toBe('fallback')
    if (moreAfterGrowth.kind === 'data') {
      const sample = (moreAfterGrowth.payload as { sample?: { id: number }[] }).sample ?? []
      expect(sample.map((r) => r.id)).not.toEqual(expect.arrayContaining([12]))
    }
  })
})
