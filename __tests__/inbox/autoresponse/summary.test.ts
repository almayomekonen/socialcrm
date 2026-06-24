import { describe, it, expect } from 'vitest'
import { deriveTemperature, buildSummary } from '@/lib/inbox/autoresponse/summary'

describe('deriveTemperature', () => {
  it('hot signal → hot', () => expect(deriveTemperature('hot_signal', {})).toBe('hot'))
  it('qualified + urgent → hot', () => expect(deriveTemperature('qualified', { urgency: 'דחוף מאוד' })).toBe('hot'))
  it('qualified, not urgent → warm', () => expect(deriveTemperature('qualified', { urgency: 'בחודש הבא' })).toBe('warm'))
  it('max_turns → warm', () => expect(deriveTemperature('max_turns', {})).toBe('warm'))
  it('uncertain → warm', () => expect(deriveTemperature('uncertain', {})).toBe('warm'))
})

describe('buildSummary (fact-grounded, no hallucination)', () => {
  const q = { name: 'דוד', need: 'CRM', urgency: 'גבוהה', budget: '5000' }

  it('includes every collected field', () => {
    const s = buildSummary({ qualification: q, reason: 'qualified', turnCount: 3, lang: 'he' })
    expect(s.text).toContain('שם: דוד')
    expect(s.text).toContain('צורך: CRM')
    expect(s.text).toContain('דחיפות: גבוהה')
    expect(s.text).toContain('תקציב: 5000')
    expect(s.text).toContain('סיבת הסלמה: qualified')
    expect(s.text).toContain('הודעות AI: 3')
  })
  it('missing fields render as a dash — never invented', () => {
    const s = buildSummary({ qualification: { name: 'דוד', need: 'CRM', urgency: 'גבוהה' }, reason: 'qualified', turnCount: 2, lang: 'he' })
    expect(s.text).toContain('תקציב: —')
    expect(s.text).toContain('מיקום: —')
    // contains only what was provided — assert no fabricated budget/location value
    expect(s.text).not.toMatch(/תקציב: \d/)
  })
  it('marks it internal / not sent to the customer', () => {
    expect(buildSummary({ qualification: q, reason: 'hot_signal', turnCount: 1, lang: 'he' }).text).toContain('לא נשלח ללקוח')
    expect(buildSummary({ qualification: q, reason: 'hot_signal', turnCount: 1, lang: 'en' }).text).toContain('not sent to the customer')
  })
  it('hot escalation → hot temperature + call action', () => {
    const s = buildSummary({ qualification: q, reason: 'hot_signal', turnCount: 1, lang: 'he' })
    expect(s.temperature).toBe('hot')
    expect(s.suggestedAction).toContain('צרו קשר')
  })
})
