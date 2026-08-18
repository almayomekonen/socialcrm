import { describe, it, expect } from 'vitest'
import { toConversationState, coerceConversationState } from '@/lib/copilot/general/conversationState'

const reasoned = (over: Record<string, unknown> = {}) => ({
  kind: 'reasoned',
  allClear: false,
  executiveDecision: 'התחל מגיא מלכה.',
  actions: [{ action: 'התקשר לגיא מלכה', why: 'מתקרר', priority: 'high', leadId: 101 }],
  moreCount: 3,
  ...over,
})

const stale = (rows: { id: number; name: string }[], total = rows.length) => ({
  total,
  sample: rows.map((r) => ({ ...r, status: null })),
})

describe('toConversationState', () => {
  it('derives state from a reasoned recommendation', () => {
    const s = toConversationState(reasoned() as never)!
    expect(s.surfacedRefIds).toEqual(['101'])
    expect(s.executiveDecision).toContain('גיא')
    expect(s.whys).toEqual(['מתקרר'])
    expect(s.subjectLead?.id).toBe(101)
    expect(s.reason).toBe('מתקרר')
  })

  it('returns null for allClear (nothing to continue)', () => {
    expect(toConversationState(reasoned({ allClear: true, actions: [] }) as never)).toBeNull()
  })

  it('derives ranked leads from crm.attention and consumes the winner', () => {
    const s = toConversationState({
      kind: 'data',
      intent: 'crm.attention',
      payload: {
        overdue: stale([]),
        dueToday: stale([]),
        stale: stale(
          [
            { id: 1, name: 'עדי שרון' },
            { id: 2, name: 'קרן שפירא' },
            { id: 3, name: 'דנה זהבי' },
            { id: 4, name: 'הדר נחום' },
          ],
          46,
        ),
      },
    } as never)!
    expect(s.subjectLead?.name).toBe('עדי שרון')
    expect(s.reason).toBe('עדיין לא יצרת איתו קשר')
    expect(s.consumedLeadIds).toEqual(['1'])
    expect(s.rankedLeads.map((l) => l.name)).toEqual(['עדי שרון', 'קרן שפירא', 'דנה זהבי', 'הדר נחום'])
    expect(s.expandedBucketIds).toContain('leads.notContactedRecently')
  })

  it('overview is continuable (counts mentioned, lists not expanded)', () => {
    const s = toConversationState({
      kind: 'data',
      intent: 'system.overview',
      payload: { summary: 'היום: 1 שיחות ממתינות · 46 לידים שלא בקשר.', counts: { staleLeads: 46 } },
    } as never)!
    expect(s.intent).toBe('system.overview')
    expect(s.expandedBucketIds).toEqual([])
  })

  it('returns null for fallback', () => {
    expect(toConversationState({ kind: 'fallback', mode: 'redirect', gap: null } as never)).toBeNull()
  })

  it('keeps previous state when the new answer is a fallback', () => {
    const prev = toConversationState({
      kind: 'data',
      intent: 'system.overview',
      payload: { summary: 'x' },
    } as never)
    expect(toConversationState({ kind: 'fallback', mode: 'clarify' } as never, prev)).toBe(prev)
  })

  it('returns null for a missing answer', () => {
    expect(toConversationState(null)).toBeNull()
    expect(toConversationState(undefined)).toBeNull()
  })

  it('coerce fills PR1 snapshots so follow-up still works', () => {
    const s = coerceConversationState({
      surfacedRefIds: ['1'],
      executiveDecision: 'x',
      whys: ['y'],
    } as never)!
    expect(s.rankedLeads[0]?.id).toBe(1)
    expect(s.reason).toBe('y')
  })

  it('overview lead-list consumption does not leak into a later priority ranking', () => {
    const names = [
      { id: 11, name: 'עדי שרון' },
      { id: 12, name: 'קרן שפירא' },
      { id: 13, name: 'דנה זהבי' },
      { id: 14, name: 'הדר נחום' },
    ]
    const overview = toConversationState({
      kind: 'data',
      intent: 'system.overview',
      payload: { summary: 'היום: 46 לידים שלא בקשר.' },
    } as never)
    const listed = toConversationState(
      { kind: 'data', intent: 'leads.notContactedRecently', payload: stale(names, 46) },
      overview,
    )
    expect(listed?.consumedLeadIds).toEqual(['11', '12', '13', '14'])

    const priority = toConversationState(
      {
        kind: 'data',
        intent: 'crm.attention',
        payload: { overdue: stale([]), dueToday: stale([]), stale: stale(names, 46) },
      },
      listed,
    )!
    expect(priority.subjectLead?.name).toBe('עדי שרון')
    expect(priority.consumedLeadIds).toEqual(['11'])
    expect(priority.rankedLeads.map((l) => l.name)).toEqual(['עדי שרון', 'קרן שפירא', 'דנה זהבי', 'הדר נחום'])
  })

  it('explicit meetings intent clears the previous lead-ranking subject', () => {
    const priority = toConversationState({
      kind: 'data',
      intent: 'crm.attention',
      payload: {
        overdue: stale([]),
        dueToday: stale([]),
        stale: stale([{ id: 11, name: 'עדי שרון' }, { id: 12, name: 'קרן שפירא' }], 46),
      },
    } as never)!
    const afterMeetings = toConversationState(
      { kind: 'data', intent: 'meetings.today', payload: { meetings: [] } },
      priority,
    )!
    expect(afterMeetings.intent).toBe('meetings.today')
    expect(afterMeetings.rankedLeads).toEqual([])
    expect(afterMeetings.consumedLeadIds).toEqual([])
    expect(afterMeetings.subjectLead).toBeNull()
    expect(afterMeetings.reason).toBeNull()
  })

  it('למה? guide keeps the active ranking so מי עוד? can continue', () => {
    const priority = toConversationState({
      kind: 'data',
      intent: 'crm.attention',
      payload: {
        overdue: stale([]),
        dueToday: stale([]),
        stale: stale([{ id: 11, name: 'עדי שרון' }, { id: 12, name: 'קרן שפירא' }], 46),
      },
    } as never)!
    const afterWhy = toConversationState({ kind: 'guide', answer: 'עדי שרון נמצא ראשון כי עדיין לא יצרת איתו קשר.' }, priority)!
    expect(afterWhy.rankedLeads.map((l) => l.id)).toEqual([11, 12])
    expect(afterWhy.consumedLeadIds).toEqual(['11'])
    expect(afterWhy.subjectLead?.name).toBe('עדי שרון')
  })
})
