import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  decideQuestionnaireTurn,
  type SessionSnapshot,
  type TurnDecision,
  type TurnFacts,
} from '@/lib/inbox/autoresponse/questionnaire/transition'
import { noteKey, rawAnswerKey } from '@/lib/inbox/autoresponse/questionnaire/answerKeys'
import { SYSTEM_LINES } from '@/lib/inbox/autoresponse/questionnaire/render'
import { LONG_1200, LONG_15, naturalDefinition } from './fixtures/naturalDefinition'

/**
 * Spec §8 (docs/superpowers/specs/2026-10-13-questionnaire-natural-answers-
 * design.md) through the real decision function, flag on. "Noted" means:
 * nothing selected, the words kept on this question, an acknowledged re-ask.
 */
const session = (stepId: string, over: Partial<SessionSnapshot> = {}): SessionSnapshot => ({
  id: 1,
  status: 'active',
  currentStepId: stepId,
  answers: { needs: ['leads'] },
  invalidCount: 0,
  lastConsumedSequence: 1,
  lastPromptAt: '2026-10-13T06:00:00.000Z',
  version: 0,
  ...over,
})
const decide = (stepId: string, texts: string[], over: Partial<TurnFacts> = {}): TurnDecision =>
  decideQuestionnaireTurn({
    definition: naturalDefinition(),
    session: session(stepId),
    inputs: texts.map((text, i) => ({ sequence: 2 + i, kind: 'text' as const, text })),
    now: new Date('2026-10-13T06:05:00.000Z'),
    routedToQuestionnaire: true,
    aiState: 'ai_qualifying',
    humanTookOver: false,
    hasPriorOutbound: true,
    leadStatusTerminal: false,
    naturalAnswers: true,
    ...over,
  })
const answers = (d: TurnDecision): Record<string, string[]> => ('answers' in d ? d.answers : {})
const expectNoted = (d: TurnDecision, stepId: string, said: string) => {
  expect(d).toMatchObject({ kind: 'question', reason: 'reprompt_noted', stepId })
  expect(answers(d)[noteKey(stepId)]).toContain(said)
  if (stepId !== 'needs') expect(answers(d)[stepId]).toBeUndefined()
  if (d.kind === 'question') expect(d.text.startsWith(SYSTEM_LINES.noted)).toBe(true)
}

describe('must accept', () => {
  it.each(['הכל', 'הכול', 'כולם', 'את הכל', 'הכל תודה'])('needs: %s selects all except אחר', (t) => {
    const d = decide('needs', [t])
    expect(d).toMatchObject({ kind: 'question', reason: 'answered', stepId: 'industry' })
    expect(answers(d).needs).toEqual(['leads', 'auto', 'follow', 'team'])
    expect(answers(d)[rawAnswerKey('needs')]).toEqual([t])
  })
  it('needs: separate 1 / 2 / 3', () => expect(answers(decide('needs', ['1', '2', '3'])).needs).toEqual(['leads', 'auto', 'follow']))
  it('source: separate 1 / 3', () => expect(answers(decide('source', ['1', '3'])).source).toEqual(['whatsapp', 'facebook']))
  it('source: בעיקר אינסטגרם וקצת פייסבוק', () =>
    expect(answers(decide('source', ['בעיקר אינסטגרם וקצת פייסבוק'])).source).toEqual(['instagram', 'facebook']))
  it('challenge: אני לא מספיק לענות לכולם', () =>
    expect(answers(decide('challenge', ['אני לא מספיק לענות לכולם'])).challenge).toEqual(['slow']))
  it.each(['צילום אירועים', 'אני צלם אירועים', 'שירותי צילום'])('industry: %s is אחר, follow-up answered and skipped', (t) => {
    const d = decide('industry', [t])
    expect(d).toMatchObject({ kind: 'question', reason: 'answered', stepId: 'team' })
    expect(answers(d).industry).toEqual(['other'])
    expect(answers(d).industry_other).toEqual([t])
  })
  it.each(['עצמאי', 'לבד'])('team: %s', (t) => expect(answers(decide('team', [t])).team).toEqual(['solo']))
  it.each(['טלפונית ב14', 'תתקשרו אליי ב14', 'תחזרו אלי מחר בבוקר'])('contact: %s completes', (t) => {
    const d = decide('contact', [t])
    expect(d).toMatchObject({ kind: 'terminal', reason: 'completed', complete: true })
    expect(answers(d).contact).toEqual([t])
  })
})

describe('long natural-language replies', () => {
  it('industry: 15 words, no phrasing → noted', () => expectNoted(decide('industry', [LONG_15]), 'industry', LONG_15))
  it('source: 20 words naming two channels → all named, words kept', () => {
    const t = 'הלקוחות כותבים לי בעיקר בוואטסאפ אבל גם הרבה מגיעים דרך פייסבוק ומדי פעם מישהו מאינסטגרם שראה פרסום'
    const d = decide('source', [t])
    expect(answers(d).source).toEqual(['whatsapp', 'instagram', 'facebook'])
    expect(answers(d)[rawAnswerKey('source')]).toEqual([t])
  })
  it('team: a long reply naming one option once', () => {
    expect(answers(decide('team', ['רוב הזמן אני לבד, לפעמים בעונה אחת עוזרת לי'])).team).toEqual(['solo'])
  })
  it('1,200 characters: no crash, note capped, nothing selected', () => {
    const d = decide('industry', [LONG_1200])
    expect(d).toMatchObject({ reason: 'reprompt_noted' })
    expect(answers(d)[noteKey('industry')].join('').length).toBeLessThanOrEqual(1000)
    expect(answers(d).industry).toBeUndefined()
  })
  it('1,200 characters at a text question: answer keeps 300, the rest goes to the note', () => {
    const d = decide('contact', [LONG_1200])
    expect(d).toMatchObject({ kind: 'terminal', reason: 'completed' })
    expect(answers(d).contact[0]).toHaveLength(300)
    expect(answers(d)[noteKey('contact')][0].startsWith('…')).toBe(true)
  })
})

describe('overlapping and contextual phrasings', () => {
  it('ניהול צוות → team only', () => expect(answers(decide('needs', ['ניהול צוות'])).needs).toEqual(['team']))
  it('ניהול צוות ולידים → both', () => expect(answers(decide('needs', ['ניהול צוות ולידים'])).needs).toEqual(['leads', 'team']))
  it('two options on a single question → clarify, nothing chosen', () => {
    const d = decide('team', ['עובדים איתי שלושה אבל בפניות מטפל רק אני'])
    expect(d).toMatchObject({ kind: 'question', reason: 'reprompt_ambiguous', stepId: 'team' })
    if (d.kind === 'question') expect(d.text.startsWith('התכוונת ל־1. רק אני או ל־2. 2 עד 3 אנשים?')).toBe(true)
    expect(answers(d).team).toBeUndefined()
  })
  it('negated phrasing → noted', () =>
    expectNoted(decide('team', ['אני לא עובד לבד, יש לי חמישה עובדים']), 'team', 'אני לא עובד לבד, יש לי חמישה עובדים'))
  it('hedged channel dropped', () =>
    expect(answers(decide('source', ['אולי בעתיד אינסטגרם, כרגע רק וואטסאפ'])).source).toEqual(['whatsapp']))
  it('exclusion → noted', () => expectNoted(decide('source', ['הכל חוץ מפייסבוק']), 'source', 'הכל חוץ מפייסבוק'))
  it("another question's phrasing → noted", () => expectNoted(decide('team', ['וואטסאפ']), 'team', 'וואטסאפ'))
})

describe('must not accept or guess', () => {
  it('team: אני עובד עם עסקים בכל הארץ → noted', () =>
    expectNoted(decide('team', ['אני עובד עם עסקים בכל הארץ']), 'team', 'אני עובד עם עסקים בכל הארץ'))
  it.each([['team'], ['industry'], ['process']])('%s: הכל → noted', (s) => expectNoted(decide(s, ['הכל']), s, 'הכל'))
  it.each(['לא הכל', 'כמעט הכל', 'הכל בסדר', 'הכל?'])('needs: %s is never all and never אחר', (t) => {
    const d = decide('needs', [t])
    expect(d).toMatchObject({ reason: 'reprompt_noted' })
    expect(answers(d).needs).toEqual(['leads']) // the session's earlier answer, untouched
  })
  it('timing: בבוקר או בערב → clarify', () => expect(decide('timing', ['בבוקר או בערב'])).toMatchObject({ reason: 'reprompt_ambiguous' }))
  it.each(['שלום', 'אוקי', '?'])('industry: %s → guided re-ask, nothing kept', (t) => {
    const d = decide('industry', [t])
    expect(d).toMatchObject({ reason: 'reprompt_invalid_choice' })
    expect(answers(d)[noteKey('industry')]).toBeUndefined()
    if (d.kind === 'question') expect(d.text.startsWith(SYSTEM_LINES.invalidChoiceGuided)).toBe(true)
  })
  it('industry: מה המחיר? → question ack', () => expect(decide('industry', ['מה המחיר?'])).toMatchObject({ reason: 'customer_question' }))
  it('team: אני נציג מכירות → not a handoff, noted', () =>
    expectNoted(decide('team', ['אני נציג מכירות']), 'team', 'אני נציג מכירות'))
  it('needs: אני נציג מכירות → not a handoff, אחר (D2)', () =>
    expect(answers(decide('needs', ['אני נציג מכירות'])).needs).toEqual(['other']))
  it('נציג → handoff', () => expect(decide('needs', ['נציג'])).toMatchObject({ kind: 'terminal', reason: 'human_request' }))
  it('אפשר לדבר עם מישהו? → handoff; the request alone is not kept as a note', () => {
    const d = decide('industry', ['אפשר לדבר עם מישהו?'])
    expect(d).toMatchObject({ kind: 'terminal', reason: 'human_request' })
    expect(answers(d)[noteKey('industry')]).toBeUndefined()
  })
  it('a handoff message with more to say is kept on the open question', () => {
    const t = 'אני צריך שמישהו יסביר לי איך זה עובד עם הצוות שלי, נציג בבקשה'
    const d = decide('industry', [t])
    expect(d).toMatchObject({ kind: 'terminal', reason: 'human_request' })
    expect(answers(d)[noteKey('industry')]).toEqual([t])
  })
  it('contact: תחזרו אליי → handoff', () => expect(decide('contact', ['תחזרו אליי'])).toMatchObject({ reason: 'human_request' }))
})

describe('review focus', () => {
  it('a session pinned before acceptsAll existed: הכל is noted, never selected', () => {
    const old = naturalDefinition((raw) => ({ ...raw, steps: raw.steps.map((s) => ({ ...s, acceptsAll: undefined })) }))
    const d = decide('needs', ['הכל'], { definition: old })
    expect(d).toMatchObject({ reason: 'reprompt_noted' })
    expect(answers(d).needs).toEqual(['leads'])
  })
  it("restart after notes: today's semantics (answers reset)", () => {
    const d = decide('team', ['התחלה מחדש'], {
      session: session('team', { answers: { needs: ['leads'], [noteKey('industry')]: ['x y z'] } }),
    })
    expect(d).toMatchObject({ kind: 'question', reason: 'restarted', answers: {} })
  })
  it('the attempt limit still ends a loop, and keeps the note', () => {
    const d = decide('industry', [LONG_15], { session: session('industry', { invalidCount: 3 }) })
    expect(d).toMatchObject({ kind: 'terminal', reason: 'invalid_limit', escalate: true })
    expect(answers(d)[noteKey('industry')]).toEqual([LONG_15])
  })
})

/**
 * Code review, 2026-10-13: inputs that must never select an option. Run on the
 * 103-shaped fixture and on agency 158's real definition.
 */
const SAMPLE_158 = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), 'scripts/questionnaire/samples/perfect-picture.he.json'), 'utf8'),
)
const decide158 = (stepId: string, texts: string[]) =>
  decide(stepId, texts, {
    definition: naturalDefinition(() => SAMPLE_158),
    session: session(stepId, { answers: { event_type: ['wedding'] } }),
  })

describe('never selects what the customer excluded (review 1)', () => {
  it.each([
    ['source', 'לא משתמשים באינסטגרם או בפייסבוק'],
    ['source', 'אין לנו אינסטגרם פייסבוק או וואטסאפ'],
    ['source', 'במקום וואטסאפ אנחנו משתמשים באינסטגרם'],
    ['source', 'הכל חוץ מפייסבוק'],
  ])('fixture %s: %s → nothing selected', (s, t) => expectNoted(decide(s, [t]), s, t))
  it.each(['הכל חוץ מוידאו', 'הכל בלי מגנטים', 'הכל מלבד העמדה', 'לא וידאו ולא מגנטים'])('158 service: %s → nothing selected', (t) => {
    const d = decide158('service', [t])
    expect(d).toMatchObject({ kind: 'question', reason: 'reprompt_noted' })
    expect(answers(d).service).toBeUndefined()
  })
  it('a hedge or negation stops at a clause break: the rest still counts', () => {
    expect(answers(decide('source', ['אולי בעתיד אינסטגרם, כרגע רק וואטסאפ'])).source).toEqual(['whatsapp'])
    expect(answers(decide('source', ['לא אינסטגרם, אבל הרבה וואטסאפ'])).source).toEqual(['whatsapp'])
  })
  it('158 keeps every answer it reads today', () => {
    expect(answers(decide158('service', ['הכל'])).service).toEqual(['all'])
    expect(answers(decide158('service', ['כל החבילה'])).service).toEqual(['all'])
    expect(answers(decide158('service', ['סטילס ווידאו'])).service).toEqual(['stills', 'video'])
    expect(answers(decide158('drone_permit', ['אין לי מושג'])).drone_permit).toEqual(['unknown'])
    expect(answers(decide158('drone_permit', ['אין אישור'])).drone_permit).toEqual(['no'])
  })
})

describe('never becomes "אחר" (review 2)', () => {
  it.each([
    'אין לי מושג', 'לא בטוח', 'עוד לא החלטתי', 'תלוי', 'שניהם', 'גם וגם', 'כל מה שיש', 'השני', 'האפשרות השלישית', 'שלוש',
    'היי אני דני', 'סליחה', 'כמובן', 'שנייה בודק', 'אני רוצה הצעת מחיר', 'שלום, ראיתי את הפרסום',
  ])('fixture industry: %s → not אחר, follow-up not filled', (t) => {
    const d = decide('industry', [t])
    expect(answers(d).industry).toBeUndefined()
    expect(answers(d).industry_other).toBeUndefined()
  })
  it.each(['אני רוצה הצעת מחיר', 'שלום, ראיתי את הפרסום'])('158 event_type: %s → not אחר', (t) => {
    const d = decide158('event_type', [t])
    expect(answers(d).event_type).toEqual(['wedding']) // the session's earlier answer, untouched
    expect(answers(d).event_other).toBeUndefined()
  })
})

describe('the follow-up is answered only by the customer\'s own "אחר" (review 3)', () => {
  it('a typed "אחר" number next to another answer still asks the follow-up', () => {
    const def = naturalDefinition((raw) => {
      const industry = raw.steps.find((s) => s.id === 'industry') as { options: Array<{ aliases?: string[] }> }
      industry.options[0].aliases = ['ייעוץ']
      return raw
    })
    const d = decide('industry', ['4', 'ייעוץ לעסקים קטנים'], { definition: def })
    expect(answers(d).industry).toEqual(['services', 'other'])
    expect(answers(d).industry_other).toBeUndefined()
    expect(d).toMatchObject({ kind: 'question', stepId: 'industry_other' })
  })
  it('158: "אחר" by its own phrasing still asks the follow-up', () => {
    const d = decide158('event_type', ['לא חתונה, משהו אחר'])
    expect(answers(d).event_type).toEqual(['other'])
    expect(answers(d).event_other).toBeUndefined()
    expect(d).toMatchObject({ kind: 'question', stepId: 'event_other' })
  })
})

describe('re-review: a negation governs its clause', () => {
  it.each([
    'לא עובדים עם אינסטגרם או עם פייסבוק',
    'לא מגיעים מאינסטגרם או דרך פייסבוק',
    'לא משתמשים באינסטגרם וכמובן גם בפייסבוק',
    'לא באמת משתמשים הרבה באינסטגרם',
  ])('fixture source: %s → nothing selected', (t) => expectNoted(decide('source', [t]), 'source', t))
  it('158 service: "לא צריך וידאו או משהו אחר" → nothing selected (the "או" continues the list)', () => {
    const d = decide158('service', ['לא צריך וידאו או משהו אחר'])
    expect(answers(d).service).toBeUndefined()
  })
  it('a contrast word ends the negation', () => {
    expect(answers(decide('source', ['לא אינסטגרם, אבל בעיקר וואטסאפ'])).source).toEqual(['whatsapp'])
    expect(answers(decide('source', ['לא מאינסטגרם, רק מפייסבוק'])).source).toEqual(['facebook'])
  })
  it('"לא X, משהו אחר" still selects אחר', () => {
    expect(answers(decide158('event_type', ['לא חתונה, משהו אחר'])).event_type).toEqual(['other'])
  })
})

describe('re-review: more non-answers never become "אחר"', () => {
  it.each(['יש לי שאלה', 'רציתי לברר משהו', 'קשה לי להגיד', 'תגיד אתה', 'הכי זול', 'דחוף'])('158 event_type: %s → not אחר', (t) => {
    const d = decide158('event_type', [t])
    expect(answers(d).event_type).toEqual(['wedding'])
    expect(answers(d).event_other).toBeUndefined()
  })
  it.each(['משרד פרסום', 'ארוחות בוקר'])('a real industry containing a common word is still אחר: %s', (t) => {
    expect(answers(decide('industry', [t])).industry).toEqual(['other'])
  })
})
