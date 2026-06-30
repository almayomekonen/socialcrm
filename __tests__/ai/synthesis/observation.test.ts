import { describe, it, expect } from 'vitest'
import { buildObservation } from '@/lib/copilot/general/synthesis/observation'
import type { ScoredCandidate } from '@/lib/copilot/general/synthesis/types'

const sc = (over: Partial<ScoredCandidate> = {}): ScoredCandidate => ({
  category: 'cluster',
  condition: 'GOING_COLD',
  memberRefIds: ['3', '4', '5'],
  scale: 0.836,
  deviation: 0,
  support: 61,
  materiality: 0.836,
  breakdown: { scale: 0.836, support: 61, gate: 1, score: 0.836 },
  ...over,
})

describe('buildObservation — C5', () => {
  it('evidenceRefIds equals memberRefIds exactly', () => {
    expect(buildObservation(sc()).evidenceRefIds).toEqual(['3', '4', '5'])
  })

  it('carries category and materiality through', () => {
    const o = buildObservation(sc({ materiality: 0.5 }))
    expect(o.category).toBe('cluster')
    expect(o.materiality).toBe(0.5)
  })

  it('statement is descriptive and contains the true count (support)', () => {
    expect(buildObservation(sc({ support: 61 })).statement).toContain('61')
  })

  it('statement names the aggregate condition (not a generic group)', () => {
    expect(buildObservation(sc({ condition: 'GOING_COLD' })).statement).toContain('מתקררים')
    expect(buildObservation(sc({ condition: 'WAITING_CUSTOMER' })).statement).toContain('ממתינים')
    expect(buildObservation(sc({ condition: 'BROKEN_COMMITMENT' })).statement).toContain('באיחור')
  })

  it('produces a distinct statement per condition', () => {
    const conditions = ['GOING_COLD', 'BROKEN_COMMITMENT', 'WAITING_CUSTOMER', 'FOLLOWUP_DUE', 'NEW_LEAD'] as const
    const statements = conditions.map((condition) => buildObservation(sc({ condition })).statement)
    expect(new Set(statements).size).toBe(conditions.length)
  })

  it('statement contains no decision/ranking/priority vocabulary', () => {
    const forbidden = ['כדאי', 'מומלץ', 'צריך', 'תעדף', 'עדיפות', 'דחוף', 'קריטי', 'הכי', 'ראשון', 'תחליט', 'פעל']
    const { statement } = buildObservation(sc())
    for (const w of forbidden) expect(statement).not.toContain(w)
  })

  it('is deterministic', () => {
    expect(buildObservation(sc())).toEqual(buildObservation(sc()))
  })

  it('does not mutate the input candidate', () => {
    const c = sc()
    const snap = JSON.parse(JSON.stringify(c))
    buildObservation(c)
    expect(c).toEqual(snap)
  })
})
