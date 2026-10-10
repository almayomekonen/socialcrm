import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  findStep,
  nextStepAfter,
  parseQuestionnaireDefinition,
  type QuestionnaireDefinition,
} from '@/lib/inbox/autoresponse/questionnaire/definition'

/**
 * The definition is the whole configuration surface of this feature, and staff
 * write it by hand. Everything it rejects here is something that would
 * otherwise reach a customer: a menu too long for a WhatsApp list, a dash the
 * send path silently rewrites, a condition pointing at a question that has not
 * been asked yet.
 */

const SAMPLE_PATH = path.join(process.cwd(), 'scripts/questionnaire/samples/event-photography.he.json')

function sample(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(SAMPLE_PATH, 'utf8'))
}

const errorsOf = (value: unknown): string[] => {
  const parsed = parseQuestionnaireDefinition(value)
  return parsed.ok === false ? parsed.errors : []
}

describe('the shipped sample', () => {
  it('validates', () => {
    const parsed = parseQuestionnaireDefinition(sample())
    expect(parsed.ok === false ? parsed.errors : []).toEqual([])
    expect(parsed.ok).toBe(true)
  })

  it('is data, not code: nothing about photography exists outside the file', () => {
    const engine = ['definition.ts', 'parseAnswer.ts', 'render.ts', 'transition.ts', 'processJob.ts', 'effects.ts']
      .map((f) => fs.readFileSync(path.join(process.cwd(), 'lib/inbox/autoresponse/questionnaire', f), 'utf8'))
      .join('\n')
    for (const word of ['חתונה', 'מגנט', 'רחפן', 'אלבום', 'צילום']) {
      expect(engine, `the engine mentions '${word}'`).not.toContain(word)
    }
  })

  it('parses a JSON string as readily as an object, so a jsonb column round-trips', () => {
    const parsed = parseQuestionnaireDefinition(JSON.stringify(sample()))
    expect(parsed.ok).toBe(true)
  })
})

describe('limits that keep an interactive upgrade possible', () => {
  it('accepts an option label up to 40 chars, longer than a WhatsApp list row (24): it is sent as the numbered menu', () => {
    const def = sample()
    ;(def.steps as Array<Record<string, unknown>>)[0].options = [
      { id: 'a', label: 'באמצעות Excel או Google Sheets' },
      { id: 'b', label: 'א'.repeat(40) },
    ]
    expect(errorsOf(def)).toEqual([])
    const parsed = parseQuestionnaireDefinition(def)
    if (!parsed.ok) throw new Error('expected a valid definition')
    const step = parsed.definition.steps[0] as { options: Array<{ label: string }> }
    expect(step.options[0].label).toBe('באמצעות Excel או Google Sheets')
  })

  it('rejects an option label longer than 40 chars, never shortens it', () => {
    const def = sample()
    ;(def.steps as Array<Record<string, unknown>>)[0].options = [
      { id: 'a', label: 'א'.repeat(41) },
      { id: 'b', label: 'ב' },
    ]
    expect(errorsOf(def).join(' ')).toContain('at most 40 characters')
  })

  it('rejects more than 10 options in one question', () => {
    const def = sample()
    ;(def.steps as Array<Record<string, unknown>>)[0].options = Array.from({ length: 11 }, (_, i) => ({
      id: `o${i}`,
      label: `אפשרות ${i}`,
    }))
    expect(errorsOf(def).length).toBeGreaterThan(0)
  })

  it('rejects a single choice, which is a statement rather than a question', () => {
    const def = sample()
    ;(def.steps as Array<Record<string, unknown>>)[0].options = [{ id: 'only', label: 'יחיד' }]
    expect(errorsOf(def).length).toBeGreaterThan(0)
  })
})

describe('copy the send path would rewrite', () => {
  it('rejects a dash in customer-facing text', () => {
    const def = sample()
    def.closing = 'תודה, נחזור אליכם בהקדם - הצוות שלנו'
    expect(errorsOf(def).join(' ')).toContain('must not contain a dash')
  })

  it('rejects an empty prompt', () => {
    const def = sample()
    ;(def.steps as Array<Record<string, unknown>>)[3].prompt = '   '
    expect(errorsOf(def).length).toBeGreaterThan(0)
  })
})

describe('structural mistakes', () => {
  it('rejects a duplicate step id', () => {
    const def = sample()
    const steps = def.steps as Array<Record<string, unknown>>
    steps[1].id = steps[0].id
    expect(errorsOf(def).join(' ')).toContain('duplicate step id')
  })

  it('rejects a duplicate option label, which WhatsApp itself refuses', () => {
    const def = sample()
    const options = (def.steps as Array<Record<string, unknown>>)[0].options as Array<Record<string, unknown>>
    options[1].label = options[0].label
    expect(errorsOf(def).join(' ')).toContain('duplicate option label')
  })

  it('rejects a condition on a later question', () => {
    const def = sample()
    const steps = def.steps as Array<Record<string, unknown>>
    steps[0].when = { step: 'event_type', anyOf: ['wedding'] }
    expect(errorsOf(def).join(' ')).toContain('not an earlier step')
  })

  it('rejects a condition on an option that does not exist', () => {
    const def = sample()
    const steps = def.steps as Array<Record<string, unknown>>
    steps[2].when = { step: 'event_type', anyOf: ['festival'] }
    expect(errorsOf(def).join(' ')).toContain('unknown option')
  })

  it('rejects a condition on a free-text answer, which has no option ids', () => {
    const def = sample()
    const steps = def.steps as Array<Record<string, unknown>>
    steps[5].when = { step: 'event_date', anyOf: ['wedding'] }
    expect(errorsOf(def).join(' ')).toContain('not a choice question')
  })

  it('rejects an unknown schema version rather than guessing at the shape', () => {
    const def = sample()
    def.schemaVersion = 2
    expect(errorsOf(def).length).toBeGreaterThan(0)
  })

  it('reports null and garbage without throwing', () => {
    expect(parseQuestionnaireDefinition(null).ok).toBe(false)
    expect(parseQuestionnaireDefinition('not json').ok).toBe(false)
    expect(parseQuestionnaireDefinition(42).ok).toBe(false)
  })
})

describe('walking the steps', () => {
  const def = (): QuestionnaireDefinition => {
    const parsed = parseQuestionnaireDefinition(sample())
    if (parsed.ok === false) throw new Error(parsed.errors.join(', '))
    return parsed.definition
  }

  it('skips a conditional question when its condition is unmet', () => {
    const answers = { services: ['stills'], event_type: ['brit'] }
    expect(nextStepAfter(def(), answers, 'event_type')?.id).toBe('event_date')
  })

  it('asks the conditional question when the condition is met', () => {
    const answers = { services: ['stills'], event_type: ['wedding'] }
    expect(nextStepAfter(def(), answers, 'event_type')?.id).toBe('wedding_coverage')
  })

  it('returns null after the last question, which is what completion means', () => {
    expect(nextStepAfter(def(), { event_type: ['brit'] }, 'area')).toBeNull()
  })

  it('finds a step by id, and reports an unknown one as missing', () => {
    expect(findStep(def(), 'guests')?.id).toBe('guests')
    expect(findStep(def(), 'nope')).toBeNull()
    expect(findStep(def(), null)).toBeNull()
  })
})
