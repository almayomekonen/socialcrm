import { describe, it, expect } from 'vitest'
import { buildAttentionDecision } from '@/lib/copilot/general/attentionDecision'
import type { BriefingLeadList } from '@/db/briefing'

const list = (total: number, top?: { name: string | null; ageDays?: number | null }): BriefingLeadList => ({
  total,
  sample: top ? [{ id: 1, name: top.name, status: null, ageDays: top.ageDays ?? null }] : [],
})
const empty = list(0)

describe('buildAttentionDecision — strict overdue → due-today → stale', () => {
  it('overdue wins; reason carries days overdue; secondary = next non-empty tier', () => {
    const d = buildAttentionDecision({
      overdue: list(3, { name: 'דוד', ageDays: 4 }),
      dueToday: empty,
      stale: list(66, { name: 'רון', ageDays: 14 }),
    })
    expect(d).toEqual({ leadName: 'דוד', reason: 'המשימה באיחור 4 ימים', secondary: { count: 66, area: 'לידים שמתקררים' } })
  })

  it('due-today wins when no overdue; reason is scheduled-today; secondary = stale (the example)', () => {
    const d = buildAttentionDecision({
      overdue: empty,
      dueToday: list(1, { name: 'ניר בן דוד' }),
      stale: list(66, { name: 'רון', ageDays: 14 }),
    })
    expect(d).toEqual({
      leadName: 'ניר בן דוד',
      reason: 'המעקב מתוזמן להיום',
      secondary: { count: 66, area: 'לידים שמתקררים' },
    })
  })

  it('stale wins when it is the only signal; reason carries days; no secondary (bottom tier)', () => {
    const d = buildAttentionDecision({ overdue: empty, dueToday: empty, stale: list(66, { name: 'רון', ageDays: 14 }) })
    expect(d).toEqual({ leadName: 'רון', reason: 'לא היית בקשר כבר 14 ימים', secondary: null })
  })

  it('singular day + null age fallbacks', () => {
    expect(buildAttentionDecision({ overdue: list(1, { name: 'א', ageDays: 1 }), dueToday: empty, stale: empty })?.reason).toBe(
      'המשימה באיחור יום אחד',
    )
    expect(
      buildAttentionDecision({ overdue: empty, dueToday: empty, stale: list(1, { name: 'ב', ageDays: null }) })?.reason,
    ).toBe('עדיין לא יצרת איתו קשר')
  })

  it('null name → fallback label', () => {
    expect(buildAttentionDecision({ overdue: list(1, { name: null }), dueToday: empty, stale: empty })?.leadName).toBe(
      'ליד ללא שם',
    )
  })

  it('waiting inbound wins before overdue, with an explainable reason', () => {
    const d = buildAttentionDecision({
      waiting: list(1, { name: 'George' }),
      overdue: list(3, { name: 'דוד', ageDays: 4 }),
      dueToday: empty,
      stale: empty,
    })
    expect(d).toEqual({
      leadName: 'George',
      reason: 'שלח הודעה ועדיין ממתין למענה',
      secondary: { count: 3, area: 'משימות באיחור' },
    })
  })

  it('all empty → no decision (null)', () => {
    expect(buildAttentionDecision({ overdue: empty, dueToday: empty, stale: empty })).toBeNull()
  })
})
