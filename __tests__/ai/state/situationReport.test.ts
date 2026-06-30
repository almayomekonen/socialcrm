import { describe, it, expect } from 'vitest'
import { classifyStates } from '@/lib/copilot/general/businessState'
import { buildSituationReport } from '@/lib/copilot/general/situationReport'
import type { FactsBundle } from '@/lib/copilot/general/facts/types'

const row = (id: number, name: string, ageDays: number | null, source: string) => ({ refId: String(id), name, status: null, ageDays, source })

const facts: FactsBundle = {
  groups: [
    { source: 'tasks.overdue', total: 1, rows: [row(1, 'גיא', 6, 'tasks.overdue') as never] },
    {
      source: 'leads.notContactedRecently',
      total: 5,
      rows: [
        row(2, 'דנה', 30, 'leads.notContactedRecently') as never,
        row(3, 'רון', 12, 'leads.notContactedRecently') as never,
        row(4, 'יעל', 9, 'leads.notContactedRecently') as never,
        row(5, 'טל', 8, 'leads.notContactedRecently') as never,
        row(6, 'נועה', 8, 'leads.notContactedRecently') as never,
      ],
    },
    { source: 'followups.promisedWaiting', total: 1, rows: [{ refId: '7', name: 'אבי', status: null, ageDays: null, waitingDays: 9, source: 'followups.promisedWaiting' } as never] },
    { source: 'leads.newThisWeek', total: 1, rows: [{ refId: '8', name: 'מאיה', status: null, ageDays: null, freshnessDays: 1, source: 'leads.newThisWeek' } as never] },
    { source: 'followups.dueToday', total: 0, rows: [] },
    { source: 'inbox.unread', total: 4, rows: [], meta: { conversations: 2, unread: 4 } },
  ],
}
const states = classifyStates(facts)

describe('Executive Situation Report — pure serializer (Phase 3 neutralized)', () => {
  const report = buildSituationReport('action', states, facts)

  it('uses neutral factual labels — no consequence / importance framing', () => {
    expect(report).toContain('משימות באיחור')
    expect(report).toContain('לא נוצר קשר לאחרונה')
    expect(report).not.toContain('מתקררים')
    expect(report).not.toContain('הופרו')
    expect(report).not.toContain('לרדת מהרדאר')
  })

  it('emits ZERO executive judgments — no criticality marker', () => {
    expect(report).not.toContain('קריטי')
  })

  it('serializes ALL states with no importance truncation', () => {
    for (const id of [2, 3, 4, 5, 6]) expect(report).toContain(`refId=${id}`)
    expect(report).not.toContain('ועוד') // listed == clusterSize → nothing folded
  })

  it('serializes the deterministic measurements (incl. the Phase-2 signals)', () => {
    expect(report).toContain('30 ימים בלי קשר') // age
    expect(report).toContain('9 ימים בהמתנה') // waiting_time
    expect(report).toContain('נוצר לפני 1 ימים') // freshness
  })

  it('preserves refIds for the Trust Gate + surfaces the inbox count', () => {
    expect(report).toContain('refId=1')
    expect(report).toContain('ממתינים בתיבה: 4 הודעות ב-2 שיחות')
  })

  it('is PERMUTATION-INVARIANT — input order cannot change the output (no salience)', () => {
    const shuffled = [...states].reverse()
    expect(buildSituationReport('action', shuffled, facts)).toEqual(report)
  })
})

describe('Executive Situation Report — summarize', () => {
  it('is counts-only with neutral labels, no item lists', () => {
    const report = buildSituationReport('summarize', states, facts)
    expect(report).toContain('לא נוצר קשר לאחרונה: 5')
    expect(report).not.toContain('refId=')
  })
})
