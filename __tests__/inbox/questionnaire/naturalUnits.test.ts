import { afterEach, describe, expect, it } from 'vitest'
import { canUseQuestionnaireNaturalAnswers } from '@/lib/flags/whatsappQuestionnaireFlags'
import { noteKey, rawAnswerKey } from '@/lib/inbox/autoresponse/questionnaire/answerKeys'
import { appendNote, handoffWords, NOTE_MAX_CHARS, noteText } from '@/lib/inbox/autoresponse/questionnaire/stepNotes'
import {
  nextUnansweredStep,
  OTHER_LABEL,
  otherFollowUpOf,
  otherOptionOf,
  preAnswerOtherFollowUp,
} from '@/lib/inbox/autoresponse/questionnaire/otherOption'
import { OTHER_LABEL as BUILDER_OTHER_LABEL } from '@/lib/inbox/autoresponse/questionnaire/builder/editorBase'
import { parseQuestionnaireDefinition, type QuestionnaireChoiceStep } from '@/lib/inbox/autoresponse/questionnaire/definition'
import { allOptionIds, isAllKeyword, mentionsAll } from '@/lib/inbox/autoresponse/questionnaire/allKeyword'
import { NATURAL_DEFINITION_RAW, naturalDefinition } from './fixtures/naturalDefinition'

const choice = (id: string): QuestionnaireChoiceStep => {
  const s = naturalDefinition().steps.find((x) => x.id === id)
  if (!s || s.type !== 'choice') throw new Error(id)
  return s
}
const step = (id: string) => {
  const s = naturalDefinition().steps.find((x) => x.id === id)
  if (!s) throw new Error(id)
  return s
}

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

describe('other option', () => {
  it('is the Builder rule, one definition', () => {
    expect(BUILDER_OTHER_LABEL).toBe(OTHER_LABEL)
  })
  it('finds "אחר" but not "מקורות אחרים"', () => {
    expect(otherOptionOf(choice('industry'))?.id).toBe('other')
    expect(otherOptionOf(choice('source'))).toBeNull()
  })
  it('finds the follow-up the Builder creates', () => {
    expect(otherFollowUpOf(naturalDefinition(), 'industry', 'other')?.id).toBe('industry_other')
    expect(otherFollowUpOf(naturalDefinition(), 'needs', 'other')).toBeNull()
  })
  it('pre-answers the follow-up only when the customer\'s words chose "אחר"', () => {
    const def = naturalDefinition()
    const viaWords = { industry: ['other'], [rawAnswerKey('industry')]: ['צילום אירועים'] }
    expect(preAnswerOtherFollowUp(def, step('industry'), viaWords).industry_other).toEqual(['צילום אירועים'])
    expect(preAnswerOtherFollowUp(def, step('industry'), { industry: ['other'] }).industry_other).toBeUndefined()
    expect(
      preAnswerOtherFollowUp(def, step('industry'), { industry: ['services'], [rawAnswerKey('industry')]: ['x'] }).industry_other,
    ).toBeUndefined()
  })
  it('skips a pre-answered step', () => {
    const def = naturalDefinition()
    expect(nextUnansweredStep(def, { industry: ['other'], industry_other: ['צילום'] }, 'industry')?.id).toBe('team')
    expect(nextUnansweredStep(def, { industry: ['other'] }, 'industry')?.id).toBe('industry_other')
  })
})

describe('"all"', () => {
  it.each(['הכל', 'הכול', 'כולם', 'כולן', 'את הכל', 'את הכול', 'כל האפשרויות', 'All', 'הכל תודה', 'הכל תודה רבה', 'הכל!', 'הכלללל', '\u200fהכל\u200f'])(
    'reads %s as all',
    (t) => expect(isAllKeyword(t)).toBe(true),
  )
  it.each(['לא הכל', 'כמעט הכל', 'הכל חוץ מפייסבוק', 'הכל חוץ מ־3', 'בכל הארץ', 'הכל טוב', 'הכל בסדר', 'הכל?', 'תודה', ''])(
    'does not read %s as all',
    (t) => expect(isAllKeyword(t)).toBe(false),
  )
  it('notices a reply that talks about all of it', () => {
    expect(mentionsAll('לא הכל')).toBe(true)
    expect(mentionsAll('בכל הארץ')).toBe(false)
  })
  it('selects every option except "אחר"-type ones, only where the owner allowed it', () => {
    expect(allOptionIds(choice('needs'))).toEqual(['leads', 'auto', 'follow', 'team'])
    expect(allOptionIds(choice('source'))).toEqual(['whatsapp', 'instagram', 'facebook'])
    expect(allOptionIds(choice('industry'))).toBeNull() // multi, not allowed
    expect(allOptionIds(choice('team'))).toBeNull() // single
  })
  it('refuses acceptsAll on a single-select question', () => {
    const raw = structuredClone(NATURAL_DEFINITION_RAW) as unknown as { steps: Array<Record<string, unknown>> }
    raw.steps.find((s) => s.id === 'team')!.acceptsAll = true
    const parsed = parseQuestionnaireDefinition(raw)
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.errors.join()).toContain('acceptsAll needs multi')
  })
})
