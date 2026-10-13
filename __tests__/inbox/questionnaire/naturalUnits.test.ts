import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { canUseQuestionnaireNaturalAnswers } from '@/lib/flags/whatsappQuestionnaireFlags'
import { noteKey, rawAnswerKey } from '@/lib/inbox/autoresponse/questionnaire/answerKeys'
import { appendNote, capText, handoffWords, NOTE_MAX_CHARS, noteText } from '@/lib/inbox/autoresponse/questionnaire/stepNotes'
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
import { readTurn } from '@/lib/inbox/autoresponse/questionnaire/readTurn'
import type { InboundInput } from '@/lib/inbox/autoresponse/questionnaire/transition'
import {
  HUMAN_HINT,
  renderClarify,
  renderReprompt,
  renderSummary,
  SYSTEM_LINES,
} from '@/lib/inbox/autoresponse/questionnaire/render'
import { hasCustomerFacingDash } from '@/lib/inbox/autoresponse/customerFacingText'
import { simulateConversation } from '@/lib/inbox/autoresponse/questionnaire/builder/simulate'
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
  it('keeps a handoff message only when it says more than the request itself', () => {
    expect(
      handoffWords(['נציג', 'אפשר נציג?', 'אפשר לדבר עם מישהו?', 'נציג בבקשה', 'אני צריך עזרה עם הפניות שלי, נציג בבקשה']),
    ).toEqual(['אני צריך עזרה עם הפניות שלי, נציג בבקשה'])
  })
  it('cuts with a visible mark and never splits an emoji', () => {
    expect(capText('abcdef', 10)).toBe('abcdef')
    expect(capText('abcdef', 4)).toBe('abc…')
    const cut = capText('ab😀cd', 4)
    expect(cut).toBe('ab…')
    expect(capText('😀'.repeat(600), NOTE_MAX_CHARS).length).toBeLessThanOrEqual(NOTE_MAX_CHARS)
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
  it('pre-answers the follow-up only with the words the "אחר" fallback read', () => {
    const def = naturalDefinition()
    const chose = { industry: ['other'], [rawAnswerKey('industry')]: ['צילום אירועים'] }
    expect(preAnswerOtherFollowUp(def, step('industry'), chose, 'צילום אירועים').industry_other).toEqual(['צילום אירועים'])
    expect(preAnswerOtherFollowUp(def, step('industry'), chose, undefined).industry_other).toBeUndefined()
    expect(preAnswerOtherFollowUp(def, step('industry'), { industry: ['services'] }, 'x').industry_other).toBeUndefined()
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
    if (parsed.ok === false) expect(parsed.errors.join()).toContain('acceptsAll needs multi')
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
    // An exclusion anywhere selects nothing (code review 2026-10-13).
    expect(m('במקום וואטסאפ אנחנו משתמשים באינסטגרם', 'source')).toEqual([])
    expect(m('לא משתמשים באינסטגרם או בפייסבוק', 'source')).toEqual([])
    expect(m('אין לנו אינסטגרם פייסבוק או וואטסאפ', 'source')).toEqual([])
    expect(m('לא אינסטגרם, אבל הרבה וואטסאפ', 'source')).toEqual(['whatsapp'])
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
  it('an option the owner named "הכל" always wins (agency 158 has one)', () => {
    const def = naturalDefinition((raw) => {
      const team = raw.steps.find((x) => x.id === 'team') as { options: Array<{ id: string; label: string; aliases?: string[] }> }
      team.options.push({ id: 'everything', label: 'הכל', aliases: ['הכל', 'הכול', 'כל החבילה'] })
      const needs = raw.steps.find((x) => x.id === 'needs') as { options: Array<{ id: string; label: string; aliases?: string[] }> }
      needs.options[1].aliases = ['הכול']
      return raw
    })
    const at = (id: string) => def.steps.find((x) => x.id === id) as QuestionnaireChoiceStep
    expect(parseChoice('הכל', at('team'), { natural: true })).toEqual({ ok: true, optionIds: ['everything'] })
    expect(parseChoice('הכול', at('team'), { natural: true })).toMatchObject({ ok: true, optionIds: ['everything'] })
    expect(parseChoice('כל החבילה', at('team'), { natural: true })).toMatchObject({ ok: true, optionIds: ['everything'] })
    // acceptsAll AND an option phrased "הכול": the owner's explicit option wins.
    expect(parseChoice('הכול', at('needs'), { natural: true })).toMatchObject({ ok: true, optionIds: ['auto'] })
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

const ins = (...texts: string[]): InboundInput[] => texts.map((text, i) => ({ sequence: 10 + i, kind: 'text', text }))

describe('readTurn (natural)', () => {
  const r = (id: string, inputs: InboundInput[], firstAskedAt = 0) => readTurn(step(id), inputs, firstAskedAt, { natural: true })
  it('unions separate numbers on a multi question', () => {
    expect(r('needs', ins('1', '2', '3'))).toMatchObject({ kind: 'answer', answer: { needs: ['leads', 'auto', 'follow'] } })
  })
  it('unions a tapped row with a typed number', () => {
    const tap: InboundInput = { sequence: 10, kind: 'text', text: 'Instagram', selectedId: 'source.instagram' }
    const typed: InboundInput = { sequence: 11, kind: 'text', text: '3' }
    expect(r('source', [tap, typed])).toMatchObject({ kind: 'answer', answer: { source: ['instagram', 'facebook'] } })
  })
  it('keeps newest-wins on a single question', () => {
    expect(r('team', ins('1', '2'))).toMatchObject({ kind: 'answer', answer: { team: ['small'] } })
  })
  it('a long reply that names nothing is noted against the question', () => {
    const long = 'אני עושה צילום אירועים בעיקר חתונות ובר מצוות באזור המרכז ולפעמים גם צילומי משפחה'
    const out = r('industry', ins(long))
    expect(out).toMatchObject({ kind: 'invalid', reason: 'noted' })
    expect(out.extras.notes).toEqual([long])
    expect(out.extras.unplaced).toEqual([])
  })
  it('two options on a single question: ambiguous, words noted', () => {
    const out = r('timing', ins('בבוקר או בערב'))
    expect(out).toMatchObject({ kind: 'invalid', reason: 'ambiguous', candidateIds: ['morning', 'evening'] })
    expect(out.extras.notes).toEqual(['בבוקר או בערב'])
  })
  it('a message sent before the question was asked stays unplaced, never in this note', () => {
    const early: InboundInput = { sequence: 5, kind: 'text', text: 'אני עושה צילום אירועים בעיקר חתונות ובר מצוות באזור המרכז' }
    const out = r('industry', [early], 8)
    expect(out.kind).toBe('early_only')
    expect(out.extras.notes).toEqual([])
    expect(out.extras.unplaced).toHaveLength(1)
  })
  it('a text answer over 300 characters keeps the rest in the note', () => {
    const out = r('contact', ins('א'.repeat(1200)))
    expect(out.kind).toBe('answer')
    if (out.kind === 'answer') expect(out.answer.contact[0]).toHaveLength(300)
    expect(out.extras.notes[0].startsWith('…')).toBe(true)
    expect(out.extras.notes[0]).toHaveLength(901)
  })
  it('flag off: no notes, no union', () => {
    const off = readTurn(step('needs'), ins('1', '2', '3'), 0)
    expect(off).toMatchObject({ kind: 'answer', answer: { needs: ['follow'] } })
    expect(off.extras.notes).toEqual([])
  })
})

describe('render (natural)', () => {
  it('guides instead of saying the answer was not recognised', () => {
    expect(renderReprompt(step('industry'), 'invalid_choice', { natural: true }).startsWith(SYSTEM_LINES.invalidChoiceGuided)).toBe(true)
    expect(renderReprompt(step('industry'), 'invalid_choice').startsWith('לא זיהינו את הבחירה.')).toBe(true)
  })
  it('acknowledges a noted reply and shows the menu', () => {
    const t = renderReprompt(step('industry'), 'noted', { natural: true })
    expect(t.startsWith(SYSTEM_LINES.noted)).toBe(true)
    expect(t).toContain('4. אחר')
  })
  it('asks only about the two options, with their menu numbers', () => {
    expect(renderClarify(choice('timing'), ['morning', 'evening'])).toBe(`התכוונת ל־1. בוקר או ל־3. ערב?\n\n${HUMAN_HINT}`)
    expect(renderReprompt(step('timing'), 'ambiguous', { natural: true, candidateIds: ['morning', 'evening'] })).toContain(
      'התכוונת ל־1. בוקר',
    )
  })
  it('no new line contains a dash the send path would rewrite', () => {
    for (const line of [SYSTEM_LINES.invalidChoiceGuided, SYSTEM_LINES.noted, renderClarify(choice('timing'), ['morning', 'evening'])]) {
      expect(hasCustomerFacingDash(line)).toBe(false)
    }
  })
  it('shows notes under their question', () => {
    const s = renderSummary(
      naturalDefinition(),
      {
        needs: ['leads'],
        industry: ['other'],
        [noteKey('industry')]: ['צילום אירועים, בעיקר חתונות'],
        [noteKey('team')]: ['אני עובד עם עסקים בכל הארץ'],
        contact: ['טלפונית'],
        [noteKey('contact')]: ['…ב14 או אחרי 17'],
        source: ['whatsapp'],
        [rawAnswerKey('source')]: ['בעיקר וואטסאפ'],
        [noteKey('source')]: ['גם קצת אתר'],
      },
      { complete: false },
    )
    expect(s).toContain('תחום: אחר (צילום אירועים, בעיקר חתונות)')
    expect(s).toContain('צוות: לא נבחרה אפשרות (אני עובד עם עסקים בכל הארץ)')
    expect(s).toContain('חזרה: טלפונית …ב14 או אחרי 17')
    expect(s).toContain('מקור: WhatsApp (בעיקר וואטסאפ; גם קצת אתר)')
  })
})

describe('Builder test chat matches production', () => {
  it('reads "צילום אירועים" only when the agency has natural answers', () => {
    const turns = [['שלום'], ['1'], ['צילום אירועים']]
    const on = simulateConversation(naturalDefinition(), turns, { naturalAnswers: true })
    const off = simulateConversation(naturalDefinition(), turns)
    expect(JSON.stringify(on.turns.at(-1))).toContain('כמה אנשים מטפלים בפניות?')
    expect(JSON.stringify(off.turns.at(-1))).toContain('לא זיהינו את הבחירה.')
  })
})

describe('real questionnaires keep every answer they read today', () => {
  const dir = path.join(process.cwd(), 'scripts/questionnaire/samples')
  it.each(fs.readdirSync(dir).filter((f) => f.endsWith('.json')))('%s: labels and phrasings select the same option', (file) => {
    const parsed = parseQuestionnaireDefinition(fs.readFileSync(path.join(dir, file), 'utf8'))
    if (parsed.ok === false) throw new Error(parsed.errors.join(', '))
    let checked = 0
    for (const s of parsed.definition.steps) {
      if (s.type !== 'choice') continue
      for (const o of s.options) {
        for (const said of [o.label, ...(o.aliases ?? [])]) {
          const today = parseChoice(said, s)
          if (today.ok === false) continue
          expect(parseChoice(said, s, { natural: true }), `${file} ${s.id} "${said}"`).toMatchObject({ ok: true, optionIds: today.optionIds })
          checked++
        }
      }
    }
    expect(checked).toBeGreaterThan(0)
  })
})
