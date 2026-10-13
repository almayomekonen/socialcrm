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
import { matchAliases } from '@/lib/inbox/autoresponse/questionnaire/aliasMatch'
import { detectCommand, parseChoice } from '@/lib/inbox/autoresponse/questionnaire/parseAnswer'
import { readAsOther } from '@/lib/inbox/autoresponse/questionnaire/otherFallback'
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

describe('phrasings in context (natural)', () => {
  const m = (t: string, id: string) => matchAliases(t, choice(id), { natural: true })
  it('longest phrase wins, a separately named option still counts', () => {
    expect(m('ניהול צוות', 'needs')).toEqual(['team'])
    expect(m('ניהול צוות ולידים', 'needs')).toEqual(['leads', 'team'])
  })
  it('a negation inside the phrase is the phrase', () => {
    expect(m('אני לא מספיק לענות לכולם', 'challenge')).toEqual(['slow'])
  })
  it('drops only the negated, excluded or hedged match', () => {
    expect(m('אולי בעתיד אינסטגרם, כרגע רק וואטסאפ', 'source')).toEqual(['whatsapp'])
    expect(m('במקום וואטסאפ אנחנו משתמשים באינסטגרם', 'source')).toEqual(['instagram'])
    expect(m('הכל חוץ מפייסבוק', 'source')).toEqual([])
    expect(m('אני לא עובד לבד, יש לי חמישה עובדים', 'team')).toEqual([])
  })
  it('reads several options in a long reply', () => {
    expect(
      m('הלקוחות כותבים לי בעיקר בוואטסאפ אבל גם הרבה מגיעים דרך פייסבוק ומדי פעם מישהו מאינסטגרם שראה פרסום', 'source'),
    ).toEqual(['whatsapp', 'instagram', 'facebook'])
  })
  it("never reads another question's phrasing", () => {
    expect(m('וואטסאפ', 'team')).toEqual([])
  })
  it('flag off: any negation still empties the whole match (today)', () => {
    expect(matchAliases('אולי בעתיד אינסטגרם, כרגע רק וואטסאפ', choice('source'))).toEqual(['whatsapp', 'instagram'])
    expect(matchAliases('לא אינסטגרם, רק וואטסאפ', choice('source'))).toEqual([])
  })
})

describe('parseChoice (natural)', () => {
  const p = (t: string, id: string) => parseChoice(t, choice(id), { natural: true })
  it('reads "all" only where allowed', () => {
    expect(p('הכל', 'needs')).toEqual({ ok: true, optionIds: ['leads', 'auto', 'follow', 'team'], via: 'alias' })
    expect(p('הכל', 'industry')).toEqual({ ok: false, reason: 'unreadable' })
    expect(p('הכל', 'team')).toEqual({ ok: false, reason: 'unreadable' })
  })
  it('names two options on a single question: ambiguous, nothing chosen', () => {
    expect(p('בבוקר או בערב', 'timing')).toEqual({ ok: false, reason: 'ambiguous', candidateIds: ['morning', 'evening'] })
    expect(p('עובדים איתי שלושה אבל בפניות מטפל רק אני', 'team')).toEqual({
      ok: false,
      reason: 'ambiguous',
      candidateIds: ['solo', 'small'],
    })
  })
  it('keycaps and bidi marks still read as numbers / the keyword', () => {
    expect(p('1️⃣ 3️⃣', 'source')).toEqual({ ok: true, optionIds: ['whatsapp', 'facebook'] })
    expect(p('\u200fהכל\u200f', 'source').ok).toBe(true)
  })
  it('flag off: unchanged', () => {
    expect(parseChoice('הכל', choice('needs'))).toEqual({ ok: false, reason: 'unreadable' })
    expect(parseChoice('בבוקר או בערב', choice('timing'))).toEqual({ ok: false, reason: 'unreadable' })
  })
})

describe('"אחר" fallback', () => {
  it.each(['צילום אירועים', 'אני צלם אירועים', 'שירותי צילום'])('accepts %s as אחר with the words', (t) => {
    expect(readAsOther(t, choice('industry'))).toEqual({ optionId: 'other', raw: t })
  })
  it.each([
    ['a question', 'מה המחיר?'],
    ['filler', 'שלום'],
    ['punctuation', '?'],
    ['a number', '7'],
    ['an "all" reply', 'לא הכל'],
    ['a correction', 'טעיתי בתשובה הקודמת'],
    ['seven words', 'אני עושה צילום אירועים בעיקר חתונות גדולות'],
  ])('refuses %s', (_, t) => expect(readAsOther(t, choice('industry'))).toBeNull())
  it('never on a question without "אחר"', () => {
    expect(readAsOther('אני עובד עם עסקים בכל הארץ', choice('team'))).toBeNull()
  })
  it('never when a phrasing matched (that is a selection or an ambiguity)', () => {
    expect(readAsOther('ניהול צוות', choice('needs'))).toBeNull()
  })
})

describe('commands in context', () => {
  const choiceCtx = { natural: true, stepType: 'choice' as const }
  const textCtx = { natural: true, stepType: 'text' as const }
  it.each(['אני נציג מכירות', 'אנחנו נציגים של חברה', 'עובד כנציג שירות'])('self-description %s is not a request', (t) => {
    expect(detectCommand(t, choiceCtx)).toBeNull()
  })
  it.each(['נציג', 'אפשר נציג', 'לדבר עם נציג', 'תעביר אותי לנציג', 'אפשר לדבר עם מישהו?', 'אני נציג, אפשר לדבר עם מישהו?'])(
    '%s still asks for a person',
    (t) => expect(detectCommand(t, choiceCtx)).toBe('human'),
  )
  it.each(['טלפונית ב14', 'תתקשרו אליי ב14', 'תחזרו אלי מחר בבוקר', 'שיחזרו אליי בערב'])('%s at a text question is the answer', (t) => {
    expect(detectCommand(t, textCtx)).toBeNull()
  })
  it('a bare callback is still a handoff, and so is one at a choice question', () => {
    expect(detectCommand('תחזרו אליי', textCtx)).toBe('human')
    expect(detectCommand('תתקשרו אליי ב14', choiceCtx)).toBe('human')
  })
  it('flag off: unchanged', () => {
    expect(detectCommand('אני נציג מכירות')).toBe('human')
    expect(detectCommand('תתקשרו אליי ב14', { stepType: 'text' })).toBe('human')
  })
  it('opt-out still outranks everything', () => {
    expect(detectCommand('תפסיקו לשלוח לי', textCtx)).toBe('opt_out')
  })
})
