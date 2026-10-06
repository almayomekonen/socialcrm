import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseQuestionnaireDefinition, type QuestionnaireDefinition } from '@/lib/inbox/autoresponse/questionnaire/definition'
import { toBuilder, toDefinition } from '@/lib/inbox/autoresponse/questionnaire/builder/convert'
import { assignIds } from '@/lib/inbox/autoresponse/questionnaire/builder/ids'
import { checkDefinitionForPublish } from '@/lib/inbox/autoresponse/questionnaire/builder/checks'
import { describeIssue } from '@/lib/inbox/autoresponse/questionnaire/builder/issues'
import { describeQuestionnaire } from '@/lib/inbox/autoresponse/questionnaire/builder/view'
import { builderQuestionnaireSchema, type BuilderQuestionnaire } from '@/lib/inbox/autoresponse/questionnaire/builder/model'
import { renderQuestion } from '@/lib/inbox/autoresponse/questionnaire/render'

/**
 * The Builder domain, without a database: lossless conversion, identity, the
 * publish check and the read view.
 *
 * "Real definitions" are the sample files that production was verified
 * byte-identical against on 2026-10-06: agency 158 revision 4
 * (perfect-picture.he.json) and agency 103 revision 1 (socialcrm-pilot.he.json).
 */

const load = (file: string): QuestionnaireDefinition => {
  const parsed = parseQuestionnaireDefinition(fs.readFileSync(path.join(process.cwd(), 'scripts/questionnaire/samples', file), 'utf8'))
  if (parsed.ok === false) throw new Error(parsed.errors.join(', '))
  return parsed.definition
}
const pp = load('perfect-picture.he.json')
const pilot = load('socialcrm-pilot.he.json')
const photo = load('event-photography.he.json')

const roundTrip = (d: QuestionnaireDefinition) => {
  const identified = assignIds(d, toBuilder(d))
  if (identified.ok === false) throw new Error(identified.error.code)
  const back = toDefinition(identified.questionnaire, d.revision)
  if (back.ok === false) throw new Error(back.error.code)
  return back.definition
}

describe('runtime definition → Builder → runtime definition is lossless', () => {
  it.each([
    ['agency 158 revision 4', pp],
    ['agency 103 revision 1', pilot],
    ['event-photography sample', photo],
  ])('%s round-trips exactly', (_, d) => {
    expect(roundTrip(d)).toEqual(d)
    // and survives the runtime schema unchanged
    expect(parseQuestionnaireDefinition(roundTrip(d))).toEqual({ ok: true, definition: d })
  })

  it('a Builder model survives the Builder schema unchanged (nothing defaulted away)', () => {
    for (const d of [pp, pilot, photo]) {
      const b = toBuilder(d)
      expect(builderQuestionnaireSchema.parse(b)).toEqual(b)
    }
  })
})

describe('the owner\'s terms', () => {
  const b = toBuilder(pp)
  const q = (id: string) => b.questions.find((x) => x.id === id)!

  it('answer kinds, never engine fields', () => {
    expect(q('event_type').answer.kind).toBe('single_choice')
    expect(q('service').answer.kind).toBe('multi_choice')
    expect(q('event_date_celebration').answer).toEqual({ kind: 'date', notSetAllowed: true })
    expect(q('event_location').answer).toEqual({ kind: 'text', notSetAllowed: true })
    expect(q('event_other').answer).toEqual({ kind: 'text', notSetAllowed: false })
    expect(toBuilder(pilot).questions.find((x) => x.answer.kind === 'text_unchecked')).toBeTruthy()
  })

  it('options carry phrasings and icons; conditions read as "shown when"', () => {
    const eventType = q('event_type').answer
    if (eventType.kind !== 'single_choice') throw new Error('kind')
    expect(eventType.options[0]).toMatchObject({ id: 'wedding', label: 'חתונה', icon: '💍', phrasings: expect.arrayContaining(['מתחתנים']) })
    expect(q('drone_city').shownWhen).toEqual({ mode: 'all', conditions: [{ questionId: 'event_type', anyOf: ['drone'] }] })
    expect(q('event_type').shownWhen).toEqual({ mode: 'always' })
    expect(b.endings.custom.map((e) => e.sentWhen.conditions[0].anyOf)).toEqual([['drone'], ['bar_bat_mitzvah', 'henna'], ['wedding']])
  })

  it('no engine vocabulary anywhere in the Builder model', () => {
    const json = JSON.stringify(toBuilder(pp))
    for (const engine of ['"when"', 'closingVariants', '"validate"', 'allowNotSet', '"aliases"', 'maxInvalidAttempts', 'schemaVersion']) {
      expect(json.includes(engine), engine).toBe(false)
    }
  })

  it('more than one condition is refused at save, never silently dropped (V1 runtime limit)', () => {
    const b2 = JSON.parse(JSON.stringify(b)) as BuilderQuestionnaire
    b2.questions[2].shownWhen = { mode: 'all', conditions: [{ questionId: 'event_type', anyOf: ['wedding'] }, { questionId: 'event_type', anyOf: ['henna'] }] }
    const ids = assignIds(pp, b2)
    if (ids.ok === false) throw new Error('ids')
    expect(toDefinition(ids.questionnaire, 4)).toMatchObject({ ok: false, error: { code: 'conditions_more_than_one_not_supported_yet' } })
  })
})

describe('stable identity', () => {
  const b = toBuilder(pp)

  it('rewording a question keeps its id', () => {
    const edited = JSON.parse(JSON.stringify(b)) as BuilderQuestionnaire
    edited.questions[2].prompt = 'באיזה תאריך האירוע?'
    const r = assignIds(pp, edited)
    expect(r.ok && r.questionnaire.questions[2].id).toBe('event_date_celebration')
  })

  it('a new question or a copy gets a fresh id; its options too', () => {
    const edited = JSON.parse(JSON.stringify(b)) as BuilderQuestionnaire
    const { id: _drop, ...copy } = edited.questions[0]
    if (copy.answer.kind !== 'single_choice') throw new Error('kind')
    copy.answer = { ...copy.answer, options: copy.answer.options.map(({ id: _o, ...o }) => o) }
    edited.questions.push(copy)
    const r = assignIds(pp, edited)
    if (r.ok === false) throw new Error(r.error.code)
    const added = r.questionnaire.questions[r.questionnaire.questions.length - 1]
    expect(added.id).toMatch(/^q_[a-z0-9]{8}$/)
    expect(new Set(r.questionnaire.questions.map((q) => q.id)).size).toBe(r.questionnaire.questions.length)
    if (added.answer.kind !== 'single_choice') throw new Error('kind')
    for (const o of added.answer.options) expect(o.id).toMatch(/^o_[a-z0-9]{8}$/)
  })

  it('an id the draft does not contain is refused: no forging, no resurrection', () => {
    const forged = JSON.parse(JSON.stringify(b)) as BuilderQuestionnaire
    forged.questions[1].id = 'q_attacker'
    expect(assignIds(pp, forged)).toMatchObject({ ok: false, error: { code: 'unknown_id', id: 'q_attacker' } })
    const optionForged = JSON.parse(JSON.stringify(b)) as BuilderQuestionnaire
    const a = optionForged.questions[0].answer
    if (a.kind !== 'single_choice') throw new Error('kind')
    a.options[0].id = 'drone_city'
    expect(assignIds(pp, optionForged)).toMatchObject({ ok: false, error: { code: 'unknown_id' } })
  })

  it('a duplicated id is refused', () => {
    const dup = JSON.parse(JSON.stringify(b)) as BuilderQuestionnaire
    dup.questions[1].id = dup.questions[0].id
    expect(assignIds(pp, dup)).toMatchObject({ ok: false, error: { code: 'duplicate_id' } })
  })
})

describe('publish check: the runtime schema, translated', () => {
  const mutate = (fn: (d: QuestionnaireDefinition) => void) => {
    const d = JSON.parse(JSON.stringify(pp)) as QuestionnaireDefinition
    fn(d)
    return checkDefinitionForPublish(d)
  }

  it('the real definitions are ready', () => {
    for (const d of [pp, pilot, photo]) expect(checkDefinitionForPublish(d).ready).toBe(true)
  })

  it.each([
    ['deleted option still used by a question', (d: QuestionnaireDefinition) => {
      const s = d.steps[0]
      if (s.type === 'choice') s.options = s.options.filter((o) => o.id !== 'wedding')
    }, 'condition_on_deleted_option', 'event_date_celebration'],
    ['deleted option still used by an ending', (d: QuestionnaireDefinition) => {
      d.closingVariants![2].when.anyOf = ['spaceship']
    }, 'ending_condition_on_deleted_option', undefined],
    ['the same phrasing on two options', (d: QuestionnaireDefinition) => {
      const s = d.steps[0]
      if (s.type === 'choice') s.options[1].aliases = [...(s.options[1].aliases ?? []), 'חתונה']
    }, 'phrasing_on_two_options', 'event_type'],
    ['an empty question', (d: QuestionnaireDefinition) => {
      d.steps[1].prompt = ''
    }, 'missing_text', 'event_other'],
    ['one option only', (d: QuestionnaireDefinition) => {
      const s = d.steps[8]
      if (s.type === 'choice') s.options = s.options.slice(0, 1)
    }, 'too_few_options', 'drone_permit'],
  ])('%s → %s', (_, fn, code, questionId) => {
    const r = mutate(fn)
    expect(r.ready).toBe(false)
    expect(r.issues).toContainEqual(expect.objectContaining({ code, severity: 'error', ...(questionId ? { questionId } : {}) }))
  })

  it('no questions at all', () => {
    expect(mutate((d) => (d.steps = [])).issues).toContainEqual(expect.objectContaining({ code: 'no_questions' }))
  })

  it('"אחר" with nothing asked after it is a suggestion, not a blocker', () => {
    const r = mutate((d) => {
      d.steps = d.steps.filter((s) => s.id !== 'service_other')
    })
    expect(r.ready).toBe(true)
    expect(r.issues).toContainEqual(expect.objectContaining({ code: 'other_without_follow_up', severity: 'warning', questionId: 'service', optionId: 'other' }))
  })

  it('every issue reads as Hebrew about the owner\'s own words, never engine text', () => {
    const r = mutate((d) => {
      const s = d.steps[0]
      if (s.type === 'choice') s.options = s.options.filter((o) => o.id !== 'wedding')
    })
    const text = r.issues.map((i) => describeIssue(i, toBuilder(pp))).join(' ')
    expect(text).toContain('"קודם כל המון מזל טוב')
    expect(text).toContain('תלויה באפשרות שנמחקה')
    expect(text).not.toMatch(/condition|step|option|when|undefined/i)
  })
})

describe('read view: the three things the editor shows', () => {
  const v = describeQuestionnaire(pp)
  const q = (id: string) => v.questions.find((x) => x.id === id)!

  it('what the customer sees is the exact production text', () => {
    for (const step of pp.steps) expect(q(step.id).customerSees).toBe(renderQuestion(step))
    expect(v.openingSees).toContain('1. חתונה 💍')
  })

  it('how they answer, and when the question appears, in plain Hebrew', () => {
    expect(q('event_type').answerSummary).toBe('בחירה אחת · 7 אפשרויות')
    expect(q('service').answerSummary).toBe('כמה אפשרויות · 6 אפשרויות')
    expect(q('event_date_celebration').answerSummary).toBe('תאריך · אפשר להמשיך גם בלי תאריך')
    expect(q('event_type').shownWhenText).toBe('תמיד')
    expect(q('drone_city').shownWhenText).toBe('רק אם: סוג האירוע / השירות הוא צילום רחפן / נדל״ן')
  })

  it('routes: each event type, its questions and its ending', () => {
    const drone = v.routes.find((r) => r.optionId === 'drone')!
    expect(drone.questionIds).toEqual(['drone_city', 'drone_permit', 'drone_date'])
    expect(drone.ending).toBe(0)
    const wedding = v.routes.find((r) => r.optionId === 'wedding')!
    // Questions that depend on a DIFFERENT question ("פירוט השירות" on "אחר") are not part of this route's outline.
    expect(wedding.questionIds).toEqual(['event_date_celebration', 'event_location', 'service'])
    expect(wedding.ending).toBe(2)
    expect(v.routes.find((r) => r.optionId === 'brit')!.ending).toBe(-1)
  })
})
