import { describe, it, expect } from 'vitest'
import { scoreExecutiveDecision } from '@/lib/copilot/general/executiveDecisionScore'
import type { GeneralReasonOutput } from '@/lib/ai/prompts/generalReason'

const base: GeneralReasonOutput = {
  allClear: false,
  executiveDecision: 'קודם גיא — הוא מתקרר.',
  actions: [{ action: 'התקשר לגיא', why: '22 ימים בלי קשר', evidence: ['101'], priority: 'high' }],
  moreCount: 3,
}

describe('Executive Decision Score — the primary quality metric', () => {
  it('passes a single decisive recommendation with a reason and a next action', () => {
    const s = scoreExecutiveDecision(base)
    expect(s.pass).toBe(true)
    expect(s.allClear).toBe(false)
  })

  it('treats allClear as valid silence, not a failed decision', () => {
    const s = scoreExecutiveDecision({ allClear: true, executiveDecision: 'הכול תחת שליטה.', actions: [], moreCount: 0 })
    expect(s.pass).toBe(true)
    expect(s.allClear).toBe(true)
  })

  it('fails when two recommendations compete at equal importance', () => {
    const s = scoreExecutiveDecision({
      ...base,
      actions: [
        { action: 'התקשר לגיא', why: 'מתקרר', evidence: ['101'], priority: 'high' },
        { action: 'התקשר לעדי', why: 'מתקררת', evidence: ['102'], priority: 'high' },
      ],
    })
    expect(s.pass).toBe(false)
    expect(s.failed).toContain('noCompetingOfEqualImportance')
  })

  it('allows secondary lower-priority actions under one primary', () => {
    const s = scoreExecutiveDecision({
      ...base,
      actions: [
        { action: 'התקשר לגיא', why: 'מתקרר', evidence: ['101'], priority: 'high' },
        { action: 'שלח הודעה לעדי', why: 'ממתינה', evidence: ['102'], priority: 'medium' },
      ],
    })
    expect(s.pass).toBe(true)
  })

  it('fails a summary with no action (a list replacing a decision)', () => {
    const s = scoreExecutiveDecision({ ...base, executiveDecision: '12 משימות, 61 לידים מתקררים', actions: [] })
    expect(s.pass).toBe(false)
    expect(s.failed).toContain('onePrimaryRecommendation')
    expect(s.failed).toContain('noListOrSummaryInsteadOfDecision')
  })

  it('fails when the primary action lacks a concrete reason', () => {
    const s = scoreExecutiveDecision({ ...base, actions: [{ action: 'התקשר לגיא', why: '  ', evidence: ['101'], priority: 'high' }] })
    expect(s.pass).toBe(false)
    expect(s.failed).toContain('oneConcreteReason')
  })
})
