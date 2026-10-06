import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  findStep,
  parseQuestionnaireDefinition,
  type QuestionnaireChoiceStep,
  type QuestionnaireDefinition,
} from '@/lib/inbox/autoresponse/questionnaire/definition'
import { parseChoice } from '@/lib/inbox/autoresponse/questionnaire/parseAnswer'
import { renderSummary } from '@/lib/inbox/autoresponse/questionnaire/render'

/**
 * Natural answers to a choice question, read from the business's own aliases.
 *
 * The bar: an obvious answer ("אני מתכנן חתונה") selects its option instantly
 * and with no model; an unclear one, or one with a "no" in front of it,
 * re-prompts exactly as before; a step with no aliases behaves exactly as it
 * always did.
 */

function load(file: string): QuestionnaireDefinition {
  const raw = fs.readFileSync(path.join(process.cwd(), 'scripts/questionnaire/samples', file), 'utf8')
  const parsed = parseQuestionnaireDefinition(raw)
  if (parsed.ok === false) throw new Error(parsed.errors.join(', '))
  return parsed.definition
}

const pp = load('perfect-picture.he.json')
const choice = (id: string) => findStep(pp, id) as QuestionnaireChoiceStep
const eventStep = choice('event_type')
const serviceStep = choice('service')
const permitStep = choice('drone_permit')

const pick = (text: string, step: QuestionnaireChoiceStep = eventStep) => {
  const r = parseChoice(text, step)
  return r.ok ? r.optionIds : null
}

describe('entry question: natural answers', () => {
  it.each([
    ['חתונה', 'wedding'],
    ['אני מתכנן חתונה', 'wedding'],
    ['אנחנו מתחתנים', 'wedding'],
    ['אני מתחתנת בדצמבר', 'wedding'],
    ['יש לנו חתונה', 'wedding'],
    ['אנחנו לפני החתונה ורוצים לבדוק צילום', 'wedding'],
    ['מחפשים צלם לחתונה', 'wedding'],
    ['חתונה ב-18.12 בראשון לציון', 'wedding'],
    ['חתונה, עוד לא יודעים תאריך', 'wedding'],
    ['בר מצווה', 'bar_bat_mitzvah'],
    ['בת מצווה', 'bar_bat_mitzvah'],
    ['בר מצווה לבן שלי', 'bar_bat_mitzvah'],
    ['אני מתכנן בר מצווה לבן שלי', 'bar_bat_mitzvah'],
    ['יש לילדה בת מצווה', 'bar_bat_mitzvah'],
    ['מחפש צילום לבר מצווה', 'bar_bat_mitzvah'],
    ['בר-מצווה', 'bar_bat_mitzvah'],
    ['בר/בת מצווה', 'bar_bat_mitzvah'],
    ['ברית', 'brit'],
    ['בריתה', 'brit'],
    ['יש לנו ברית', 'brit'],
    ['ברית לבן', 'brit'],
    ['צילום לבריתה', 'brit'],
    ['חינה', 'henna'],
    ['יש לנו חינה', 'henna'],
    ['אנחנו עושים חינה', 'henna'],
    ['מחפשים צילום לחינה', 'henna'],
    ['צריך רחפן לצילום נכס', 'drone'],
    ['צילום נדלן', 'drone'],
    ['צילום נדל״ן', 'drone'],
    ['צילום נדל"ן לדירה בחולון', 'drone'],
    ['אירוע עסקי', 'business'],
    ['אירוע חברה', 'business'],
    ['יש לנו אירוע חברה', 'business'],
    ['כנס', 'business'],
    ['אירוע לעובדים', 'business'],
    ['אירוע של החברה', 'business'],
    ['משהו אחר', 'other'],
  ])('reads %j as %s', (input, expected) => {
    expect(pick(input)).toEqual([expected])
  })

  it('marks natural answers so the customer words are kept; numbers and labels are not', () => {
    expect(parseChoice('אני מתכנן חתונה', eventStep)).toEqual({ ok: true, optionIds: ['wedding'], via: 'alias' })
    expect(parseChoice('2', eventStep)).toEqual({ ok: true, optionIds: ['bar_bat_mitzvah'] })
    expect(parseChoice('5', eventStep)).toEqual({ ok: true, optionIds: ['drone'] })
    expect(parseChoice('חינה', eventStep)).toEqual({ ok: true, optionIds: ['henna'] })
    expect(parseChoice('אירוע אחר', eventStep)).toEqual({ ok: true, optionIds: ['other'] })
  })

  it.each([
    'עוד לא החלטנו איזה אירוע',
    'אירוע',
    'שלום',
    'כמה זה עולה?',
    'יום הולדת 40',
    'חתונה או בר מצווה',
    'לא חתונה, בר מצווה',
    'צילום רחפן לחתונה',
    'מבחינה של תאריך עוד לא יודעים',
    'אנחנו מארצות הברית',
    'נכנסתי לאתר שלכם',
  ])('does not guess on %j', (input) => {
    expect(pick(input)).toBeNull()
  })
})

describe('service question: natural answers, several allowed', () => {
  it.each([
    ['צריך סטילס', ['stills']],
    ['רוצים וידאו', ['video']],
    ['מגנטים', ['magnets']],
    ['רוצים מגנטים', ['magnets']],
    ['עמדת צילום', ['booth']],
    ['אנחנו רוצים הכל', ['all']],
    ['הכל', ['all']],
    ['סטילס ווידאו', ['stills', 'video']],
    ['1,3', ['stills', 'magnets']],
    ['אחר', ['other']],
    ['משהו אחר', ['other']],
  ])('reads %j as %j', (input, expected) => {
    expect(pick(input, serviceStep)).toEqual(expected)
  })

  it.each(['לא צריך וידאו', 'הכל חוץ ממגנטים', 'עוד לא יודעים', 'כמה עולה צלם?'])('does not guess on %j', (input) => {
    expect(pick(input, serviceStep)).toBeNull()
  })
})

describe('flight permission: negation is never read as yes', () => {
  it.each([
    ['כן', 'yes'],
    ['כן יש', 'yes'],
    ['יש לנו אישור', 'yes'],
    ['לא', 'no'],
    ['אין', 'no'],
    ['אין לי', 'no'],
    ['עדיין לא', 'no'],
    ['לא קיים', 'no'],
    ['לא יודע', 'unknown'],
    ['לא בטוח', 'unknown'],
    ['לא בטוחה', 'unknown'],
    ['אין לי מושג', 'unknown'],
    ['צריך לבדוק', 'unknown'],
  ])('reads %j as %s', (input, expected) => {
    expect(pick(input, permitStep)).toEqual([expected])
  })

  it.each(['כן, אבל לא באזור הזה', 'לא יודע אם יש אישור', 'אולי'])('does not guess on %j', (input) => {
    expect(pick(input, permitStep)).toBeNull()
  })
})

describe('a step without aliases is unchanged', () => {
  const plain: QuestionnaireChoiceStep = {
    ...eventStep,
    options: eventStep.options.map(({ id, label }) => ({ id, label })),
  }
  it.each(['אני מתכנן חתונה', 'יש לנו ברית', 'בר מצווה'])('still refuses %j', (input) => {
    expect(pick(input, plain)).toBeNull()
  })
  it('the shipped sample without aliases reads only numbers and labels', () => {
    const sample = load('event-photography.he.json')
    const step = sample.steps.find((s) => s.type === 'choice') as QuestionnaireChoiceStep
    expect(step.options.every((o) => o.aliases === undefined)).toBe(true)
    expect(sample.closingVariants).toBeUndefined()
    expect(pick('1', step)).toEqual([step.options[0].id])
    expect(pick(`אני רוצה ${step.options[0].label}`, step)).toBeNull()
  })
})

describe('definition validation', () => {
  it('rejects one alias on two options of the same step', () => {
    const bad = JSON.parse(JSON.stringify(pp))
    bad.steps[0].options[1].aliases.push('חתונה')
    const parsed = parseQuestionnaireDefinition(bad)
    expect(parsed.ok).toBe(false)
    if (parsed.ok === false) expect(parsed.errors.join(' ')).toContain("belongs to both 'wedding' and 'bar_bat_mitzvah'")
  })

  it('rejects a closing variant that points at an unknown option or a text question', () => {
    const unknownOption = JSON.parse(JSON.stringify(pp))
    unknownOption.closingVariants[0].when.anyOf = ['spaceship']
    const textStep = JSON.parse(JSON.stringify(pp))
    textStep.closingVariants[0].when.step = 'drone_city'
    for (const bad of [unknownOption, textStep]) {
      expect(parseQuestionnaireDefinition(bad).ok).toBe(false)
    }
  })
})

describe('what the rep reads', () => {
  it('shows the category with the customer words, and only the questions asked', () => {
    const summary = renderSummary(
      pp,
      {
        event_type: ['bar_bat_mitzvah'],
        'event_type:raw': ['אני מתכנן בר מצווה לבן שלי'],
        event_date_celebration: ['18.11.2026'],
        event_location: ['רחובות'],
        service: ['all'],
      },
      { complete: true },
    )
    expect(summary).toBe(
      [
        'שאלון וואטסאפ הושלם',
        'סוג האירוע / השירות: בר / בת מצווה (אני מתכנן בר מצווה לבן שלי)',
        'תאריך האירוע: 18.11.2026',
        'מיקום האירוע: רחובות',
        'שירות צילום: הכל',
      ].join('\n'),
    )
  })
})
