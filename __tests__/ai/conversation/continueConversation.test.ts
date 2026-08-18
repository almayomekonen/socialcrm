import { describe, it, expect } from 'vitest'
import { toConversationState } from '@/lib/copilot/general/conversationState'
import {
  explainWhy,
  hasUsableFollowUpState,
  nextLeads,
  NOTHING_MORE,
  NO_MORE_LEADS,
  resolveFollowUp,
} from '@/lib/copilot/general/continueConversation'

const emptyList = { total: 0, sample: [] }
const attention = toConversationState({
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
} as never)!

const overview = toConversationState({
  kind: 'data',
  intent: 'system.overview',
  payload: {
    summary: 'היום: 1 שיחות ממתינות · 46 לידים שלא בקשר.',
    counts: { overdueTasks: 0, meetingsToday: 0, waitingConversations: 1, staleLeads: 46, newLeads: 0 },
  },
} as never)!

describe('continueConversation — deterministic follow-ups', () => {
  it('למה? explains the same lead from stored facts', () => {
    const why = explainWhy(attention)!
    expect(why).toContain('עדי שרון')
    expect(why).toContain('עדיין לא יצרת איתו קשר')
    expect(why).toContain('אין כרגע משימה באיחור או מעקב להיום')
    expect(why).not.toMatch(/\d[\d,]+\s*₪/)
  })

  it('מי עוד? returns the next leads and not the winner', () => {
    const next = nextLeads(attention)
    expect(next.map((l) => l.name)).toEqual(['קרן שפירא', 'דנה זהבי', 'הדר נחום'])
    expect(next.map((l) => l.id)).not.toContain(11)
  })

  it('מי עוד? payload keeps deep-linkable ids from state only', async () => {
    const res = await resolveFollowUp('מי עוד?', attention, async () => {
      throw new Error('must not fetch')
    })
    expect(res?.kind).toBe('data')
    if (res?.kind !== 'data') return
    const sample = (res.payload as { sample: { id: number; name: string }[] }).sample
    expect(sample.map((r) => r.id)).toEqual([12, 13, 14])
    expect(sample.every((r) => attention.rankedLeads.some((l) => l.id === r.id))).toBe(true)
  })

  it('מה עוד? after overview returns the next unused CRM bucket, not the overview sentence', async () => {
    const loads: string[] = []
    const res = await resolveFollowUp('מה עוד?', overview, async (intent) => {
      loads.push(intent)
      if (intent === 'inbox.unread') return { conversations: 1, unread: 2 }
      if (intent === 'meetings.today') return { meetings: [] }
      return { total: 0, sample: [] }
    })
    expect(res).toEqual({ kind: 'data', intent: 'inbox.unread', payload: { conversations: 1, unread: 2 } })
    expect(loads[0]).toBe('tasks.overdue')
    expect(res).not.toMatchObject({ payload: { summary: expect.anything() } })
  })

  it('מה עוד? when every bucket is empty says nothing more', async () => {
    const res = await resolveFollowUp('מה עוד?', overview, async (intent) => {
      if (intent === 'meetings.today') return { meetings: [] }
      if (intent === 'inbox.unread') return { conversations: 0, unread: 0 }
      return { total: 0, sample: [] }
    })
    expect(res).toEqual({ kind: 'guide', answer: NOTHING_MORE })
  })

  it('no usable state → resolveFollowUp returns null (caller keeps clarify)', async () => {
    expect(await resolveFollowUp('מה עוד?', null, async () => ({}))).toBeNull()
    expect(await resolveFollowUp('למה?', null, async () => ({}))).toBeNull()
    expect(hasUsableFollowUpState(null, 'follow_up')).toBe(false)
    expect(hasUsableFollowUpState(null, 'why')).toBe(false)
  })

  it('איך? on overview is not usable (no recommendation)', () => {
    expect(hasUsableFollowUpState(overview, 'how')).toBe(false)
    expect(hasUsableFollowUpState(attention, 'how')).toBe(true)
  })

  it('who_else with all leads consumed → no more leads, not a fetch', async () => {
    const exhausted = { ...attention, consumedLeadIds: attention.rankedLeads.map((l) => String(l.id)) }
    const res = await resolveFollowUp('מי עוד?', exhausted, async () => {
      throw new Error('must not fetch')
    })
    expect(res).toEqual({ kind: 'guide', answer: NO_MORE_LEADS })
  })

  it('repeated מי עוד? advances the ranking cursor instead of repeating', async () => {
    const wide = toConversationState({
      kind: 'data',
      intent: 'crm.attention',
      payload: {
        overdue: emptyList,
        dueToday: emptyList,
        stale: {
          total: 7,
          sample: [
            { id: 11, name: 'עדי שרון', status: null },
            { id: 12, name: 'קרן שפירא', status: null },
            { id: 13, name: 'דנה זהבי', status: null },
            { id: 14, name: 'הדר נחום', status: null },
            { id: 15, name: 'אורי רוזן', status: null },
            { id: 16, name: 'שני קפלן', status: null },
            { id: 17, name: 'יוסי שמש', status: null },
          ],
        },
      },
    } as never)!
    const first = await resolveFollowUp('מי עוד?', wide, async () => {
      throw new Error('must not fetch')
    })
    expect(first?.kind).toBe('data')
    if (first?.kind !== 'data') return
    const firstNames = (first.payload as { sample: { name: string }[] }).sample.map((r) => r.name)
    expect(firstNames).toEqual(['קרן שפירא', 'דנה זהבי', 'הדר נחום'])

    const afterFirst = toConversationState(first, wide)!
    const second = await resolveFollowUp('מי עוד?', afterFirst, async () => {
      throw new Error('must not fetch')
    })
    expect(second?.kind).toBe('data')
    if (second?.kind !== 'data') return
    const secondNames = (second.payload as { sample: { name: string }[] }).sample.map((r) => r.name)
    expect(secondNames).toEqual(['אורי רוזן', 'שני קפלן', 'יוסי שמש'])
    expect(secondNames.some((n) => firstNames.includes(n))).toBe(false)
    expect(secondNames).not.toContain('עדי שרון')
  })

  it('after meetings, מי עוד? is not a ranking continuation', async () => {
    const afterMeetings = toConversationState(
      { kind: 'data', intent: 'meetings.today', payload: { meetings: [] } },
      attention,
    )
    expect(hasUsableFollowUpState(afterMeetings, 'who_else')).toBe(false)
    expect(hasUsableFollowUpState(afterMeetings, 'why')).toBe(false)
    expect(await resolveFollowUp('מי עוד?', afterMeetings, async () => {
      throw new Error('must not fetch')
    })).toBeNull()
  })
})
