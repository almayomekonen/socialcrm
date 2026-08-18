import { describe, it, expect } from 'vitest'
import { composeBusinessAdvice, classifyBusinessAdvice } from '@/lib/copilot/general/businessAdvice'
import { composeGrowthCopy } from '@/lib/copilot/general/growthCopy'

const counts = {
  overdueTasks: 0,
  dueToday: 0,
  staleLeads: 42,
  waitingConversations: 1,
  newLeads: 40,
  meetingsToday: 0,
}

describe('classifyBusinessAdvice', () => {
  it('maps business questions to kinds', () => {
    expect(classifyBusinessAdvice('מה מצב העסק?')).toBe('state')
    expect(classifyBusinessAdvice('מה אני יכול לעשות כדי לקדם את העסק?')).toBe('advice')
    expect(classifyBusinessAdvice('מה אתה רואה?')).toBe('see')
    expect(classifyBusinessAdvice('איפה אני מפסיד לידים?')).toBe('leak')
  })
})

describe('composeBusinessAdvice — interpretation, not a dump', () => {
  it('advice leads with a priority and grounds the 42 + waiting case', () => {
    const text = composeBusinessAdvice('advice', counts)
    expect(text).toContain('הייתי מתמקד')
    expect(text).toContain('42 לידים')
    expect(text).toContain('1 שיחה שממתינה')
    expect(text).toContain('אין לי נתוני הכנסה')
    expect(text).not.toMatch(/\d[\d,]+\s*₪/)
    expect(text).not.toMatch(/%/)
    expect(text).not.toContain('סיכוי גבוה')
    expect(text).not.toContain('יגדיל המרות')
  })

  it('state is not the raw overview sentence', () => {
    const text = composeBusinessAdvice('state', counts)
    expect(text).not.toMatch(/^היום: /)
    expect(text).toContain('42')
    expect(text).not.toContain('סיכוי גבוה')
  })

  it('see lists at most three observations', () => {
    const text = composeBusinessAdvice('see', counts)
    expect(text).toContain('מה שאני רואה כרגע')
    expect(text).toContain('1.')
    expect(text).toContain('2.')
    expect(text).not.toContain('המרה נמוכה')
    expect(text).not.toMatch(/₪/)
  })

  it('leak with evidence stays operational; leak without evidence is honest', () => {
    const withEvidence = composeBusinessAdvice('leak', counts)
    expect(withEvidence).toContain('42')
    expect(withEvidence).not.toContain('מפסיד כסף')

    const insufficient = composeBusinessAdvice('leak', {
      overdueTasks: 0,
      dueToday: 0,
      staleLeads: 0,
      waitingConversations: 0,
      newLeads: 0,
      meetingsToday: 0,
    })
    expect(insufficient).toContain('אני לא יכול לקבוע')
    expect(insufficient).not.toMatch(/₪/)
  })

  it('composeGrowthCopy delegates to advice', () => {
    expect(composeGrowthCopy(counts)).toBe(composeBusinessAdvice('advice', counts))
  })
})
