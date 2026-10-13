import { afterEach, describe, expect, it } from 'vitest'
import { canUseQuestionnaireNaturalAnswers } from '@/lib/flags/whatsappQuestionnaireFlags'
import { noteKey } from '@/lib/inbox/autoresponse/questionnaire/answerKeys'
import { appendNote, handoffWords, NOTE_MAX_CHARS, noteText } from '@/lib/inbox/autoresponse/questionnaire/stepNotes'

/**
 * The natural-answers building blocks, one concern per describe block
 * (docs/superpowers/specs/2026-10-13-questionnaire-natural-answers-design.md).
 */

describe('flag', () => {
  afterEach(() => {
    delete process.env.WA_QUESTIONNAIRE_ENABLED
    delete process.env.WA_QUESTIONNAIRE_AGENCY_IDS
    delete process.env.WA_QUESTIONNAIRE_NATURAL_AGENCY_IDS
  })
  it('is off when its allowlist is absent, even where the questionnaire speaks', () => {
    process.env.WA_QUESTIONNAIRE_ENABLED = '1'
    process.env.WA_QUESTIONNAIRE_AGENCY_IDS = 'all'
    expect(canUseQuestionnaireNaturalAnswers(103)).toBe(false)
  })
  it('is on only for listed agencies, and only where the questionnaire speaks', () => {
    process.env.WA_QUESTIONNAIRE_NATURAL_AGENCY_IDS = '103'
    expect(canUseQuestionnaireNaturalAnswers(103)).toBe(false)
    process.env.WA_QUESTIONNAIRE_ENABLED = '1'
    process.env.WA_QUESTIONNAIRE_AGENCY_IDS = '103,158'
    expect(canUseQuestionnaireNaturalAnswers(103)).toBe(true)
    expect(canUseQuestionnaireNaturalAnswers(158)).toBe(false)
    expect(canUseQuestionnaireNaturalAnswers(null)).toBe(false)
  })
})

describe('step notes', () => {
  it('keeps words against the question, in order, once each', () => {
    let a: Record<string, string[]> = { industry: [] }
    a = appendNote(a, 'industry', ['צילום אירועים בעיקר חתונות', 'צילום אירועים בעיקר חתונות', 'וגם משפחות'])
    expect(a[noteKey('industry')]).toEqual(['צילום אירועים בעיקר חתונות', 'וגם משפחות'])
    expect(noteText(a, 'industry')).toBe('צילום אירועים בעיקר חתונות; וגם משפחות')
    expect(noteText(a, 'team')).toBeNull()
  })
  it('never grows past 1,000 characters and marks the cut', () => {
    const a = appendNote({}, 'industry', ['א'.repeat(1200)])
    const stored = a[noteKey('industry')]
    expect(stored.join('').length).toBe(NOTE_MAX_CHARS)
    expect(stored[0].endsWith('…')).toBe(true)
    expect(appendNote(a, 'industry', ['עוד'])).toBe(a)
  })
  it('returns the same object when nothing is added', () => {
    const a = { x: ['1'] }
    expect(appendNote(a, 'industry', ['', '   '])).toBe(a)
  })
  it('keeps a handoff message that says more than the request', () => {
    expect(handoffWords(['נציג', 'אפשר לדבר עם מישהו?', 'אני צריך עזרה עם הפניות שלי, נציג בבקשה'])).toEqual([
      'אפשר לדבר עם מישהו?',
      'אני צריך עזרה עם הפניות שלי, נציג בבקשה',
    ])
  })
})
