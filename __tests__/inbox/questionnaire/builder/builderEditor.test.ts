import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseQuestionnaireDefinition, type QuestionnaireDefinition } from '@/lib/inbox/autoresponse/questionnaire/definition'
import { renderOpening, renderQuestion } from '@/lib/inbox/autoresponse/questionnaire/render'
import { finalizeCustomerFacingText, hasCustomerFacingDash } from '@/lib/inbox/autoresponse/customerFacingText'
import { toBuilder, toDefinition } from '@/lib/inbox/autoresponse/questionnaire/builder/convert'
import { assignIds } from '@/lib/inbox/autoresponse/questionnaire/builder/ids'
import { checkDefinitionForPublish } from '@/lib/inbox/autoresponse/questionnaire/builder/checks'
import { cleanBusinessName, emptyQuestionnaire, openingFor } from '@/lib/inbox/autoresponse/questionnaire/builder/skeleton'
import { simulateConversation } from '@/lib/inbox/autoresponse/questionnaire/builder/simulate'
import { describeCondition } from '@/lib/inbox/autoresponse/questionnaire/builder/conditionText'
import { deriveEditorView } from '@/lib/inbox/autoresponse/questionnaire/builder/editorView'
import { explainRecognized } from '@/lib/inbox/autoresponse/questionnaire/builder/explainText'
import {
  addEnding,
  addOption,
  addQuestion,
  adoptIds,
  conditionOf,
  conditionSources,
  dependentsOf,
  disableOther,
  enableOther,
  keyOf,
  moveEnding,
  moveQuestion,
  optionsOf,
  otherOf,
  removeOption,
  removeQuestion,
  setAnswerKind,
  setNotSetAllowed,
  setShownWhen,
  updateEnding,
  updateOption,
  updateQuestion,
} from '@/lib/inbox/autoresponse/questionnaire/builder/editorOps'
import type { BuilderQuestionnaire } from '@/lib/inbox/autoresponse/questionnaire/builder/model'

/**
 * The PR2 conversation editor's domain, without a browser or a database: the
 * editor operations, the live preview and its parity with production, the
 * server's handling of browser refs, the clean first-run skeleton, and the
 * simulator explanation fix.
 *
 * Real definitions: agency 158 revision 4 (perfect-picture.he.json) and agency
 * 103 revision 1 (socialcrm-pilot.he.json), the files production was verified
 * byte-identical against.
 */

const load = (file: string): QuestionnaireDefinition => {
  const parsed = parseQuestionnaireDefinition(
    fs.readFileSync(path.join(process.cwd(), 'scripts/questionnaire/samples', file), 'utf8'),
  )
  if (parsed.ok === false) throw new Error(parsed.errors.join(', '))
  return parsed.definition
}
const pp = load('perfect-picture.he.json')
const pilot = load('socialcrm-pilot.he.json')

const q = (m: BuilderQuestionnaire, key: string) => m.questions.find((x) => keyOf(x) === key)!

/** A minimal ready questionnaire, as the editor would hold it. */
function salon(): BuilderQuestionnaire {
  return toBuilder({
    schemaVersion: 1,
    revision: 1,
    language: 'he',
    welcome: 'היי 👋 תודה שפניתם לסלון דנה.',
    closing: 'תודה! נחזור אליכם בהקדם.',
    handoff: 'העברנו לצוות.',
    summaryTitle: 'שאלון הושלם',
    maxInvalidAttempts: 2,
    expireAfterHours: 24,
    steps: [
      {
        id: 'service',
        type: 'choice',
        label: 'שירות',
        prompt: 'איזה טיפול מעניין אתכם?',
        options: [
          { id: 'hair', label: 'תספורת', icon: '✂️' },
          { id: 'nails', label: 'ציפורניים' },
        ],
      },
      { id: 'date', type: 'text', label: 'תאריך', prompt: 'לאיזה תאריך?', validate: 'date', allowNotSet: true },
    ],
  } as QuestionnaireDefinition)
}

// ── Browser refs resolved by the server ────────────────────────────────────

describe('a new option can be referenced before it has an id (refs)', () => {
  const converted = toDefinition(salon() as Parameters<typeof toDefinition>[0], 1)
  if (converted.ok === false) throw new Error(converted.error.code)
  const stored = converted.definition

  it('"אחר" and its follow-up, created together, resolve to fresh server ids', () => {
    const edited = enableOther(toBuilder(stored), 'service')
    const other = otherOf(edited, 'service')!
    expect(other.option.ref).toMatch(/^new_/)
    expect(other.followUp?.ref).toMatch(/^new_/)

    const res = assignIds(stored, edited)
    if (res.ok === false) throw new Error(res.error.code)
    const optionId = res.assigned[other.option.ref!]
    const followUpId = res.assigned[other.followUp!.ref!]
    expect(optionId).toMatch(/^o_[a-z0-9]{8}$/)
    expect(followUpId).toMatch(/^q_[a-z0-9]{8}$/)
    const followUp = res.questionnaire.questions.find((x) => x.id === followUpId)!
    expect(followUp.shownWhen).toEqual({ mode: 'all', conditions: [{ questionId: 'service', anyOf: [optionId] }] })
    // No ref survives into what is stored.
    expect(JSON.stringify(res.questionnaire)).not.toContain('new_')
    const converted = toDefinition(res.questionnaire, 2)
    expect(converted.ok).toBe(true)
    if (converted.ok) expect(checkDefinitionForPublish(converted.definition).ready).toBe(true)
  })

  it('a condition on a brand-new question resolves too, and so does an ending', () => {
    let m = addQuestion(toBuilder(stored))
    const added = m.questions[m.questions.length - 1]
    m = updateQuestion(m, keyOf(added), { prompt: 'מה התקציב?', label: 'תקציב' })
    const opt = optionsOf(q(m, keyOf(added)))[0]
    m = addEnding(m, { questionId: keyOf(added), anyOf: [keyOf(opt)] })
    const res = assignIds(stored, m)
    if (res.ok === false) throw new Error(res.error.code)
    const qid = res.assigned[added.ref!]
    expect(res.questionnaire.endings.custom[0].sentWhen.conditions[0]).toEqual({
      questionId: qid,
      anyOf: [res.assigned[opt.ref!]],
    })
  })

  it('a ref can never shadow an existing id, and two entities cannot share one', () => {
    const m = toBuilder(stored)
    const forged = {
      ...m,
      questions: [
        ...m.questions,
        { ...m.questions[1], id: undefined, ref: 'new_x' },
        { ...m.questions[1], id: undefined, ref: 'new_x' },
      ],
    }
    expect(assignIds(stored, forged)).toMatchObject({ ok: false, error: { code: 'duplicate_id', id: 'new_x' } })
  })

  it('adoptIds hands the server ids back to the editor, conditions included', () => {
    const edited = enableOther(toBuilder(stored), 'service')
    const res = assignIds(stored, edited)
    if (res.ok === false) throw new Error(res.error.code)
    const adopted = adoptIds(edited, res.assigned)
    expect(JSON.stringify(adopted)).not.toContain('new_')
    const other = otherOf(adopted, 'service')!
    expect(other.option.id).toBe(res.assigned[otherOf(edited, 'service')!.option.ref!])
    expect(conditionOf(other.followUp!)?.anyOf).toEqual([other.option.id])
  })
})

// ── First run ────────────────────────────────────────────────────────────────

describe('the first-run skeleton', () => {
  it('never inherits a dash from the agency name (the PR1 production finding)', () => {
    expect(cleanBusinessName('Demo — Yuton')).toBe('Demo Yuton')
    expect(cleanBusinessName('Studio - Tel Aviv')).toBe('Studio Tel Aviv')
    for (const name of ['Demo — Yuton', 'א–ב', '---', null, '']) {
      const opening = openingFor(name)
      expect(hasCustomerFacingDash(opening)).toBe(false)
    }
    expect(openingFor('Demo — Yuton')).toContain('ל־Demo Yuton.')
    expect(openingFor('סלון דנה')).toContain('לסלון דנה.')
    expect(openingFor('---')).toContain('תודה שפניתם אלינו.')
  })

  it('starts with a natural opening and a first question to fill in, and reports only what is missing', () => {
    const skeleton = emptyQuestionnaire('Demo — Yuton')
    expect(skeleton.steps).toHaveLength(1)
    const check = checkDefinitionForPublish(skeleton)
    expect(check.ready).toBe(false)
    // Only the two empty answers need the owner; no generic "invalid", no dash issue.
    expect(check.issues.map((i) => i.code)).toEqual(['missing_text', 'missing_text'])
    expect(check.issues.every((i) => i.questionId === 'request_type' && i.optionId)).toBe(true)
  })

  it('a salon fills it in: opening → service choice → preferred date → ending, ready to publish', () => {
    let m = toBuilder(emptyQuestionnaire('סלון דנה'))
    const first = keyOf(m.questions[0])
    const [a, b] = optionsOf(m.questions[0]).map(keyOf)
    m = updateOption(m, first, a, { label: 'תספורת' })
    m = updateOption(m, first, b, { label: 'צבע' })
    m = addQuestion(m)
    const date = keyOf(m.questions[1])
    m = setAnswerKind(m, date, 'date')
    m = updateQuestion(m, date, { prompt: 'לאיזה תאריך תרצו לקבוע?', label: 'תאריך מועדף' })
    const view = deriveEditorView(m)
    expect(view.ready).toBe(true)
    expect(view.opening).toContain('1. תספורת')
    expect(view.endings.standard).toContain('קיבלנו את הפרטים')
  })
})

// ── Simulator explanation (PR1 finding) ─────────────────────────────────────

describe('the simulator explanation', () => {
  it('reports a text answer as text, never under optionIds', () => {
    const sim = simulateConversation(pp, [['היי'], ['חתונה'], ['15.8.2027']])
    const date = sim.turns[2].explanation.recognized.find((r) => r.questionId === 'event_date_celebration')!
    expect(date).toBeDefined()
    expect(date.optionIds).toBeUndefined()
    expect(typeof date.text).toBe('string')
    expect(date.text!.length).toBeGreaterThan(0)
  })

  it('still reports a choice as optionIds (backward compatible)', () => {
    const sim = simulateConversation(pp, [['היי'], ['אנחנו מתחתנים']])
    expect(sim.turns[1].explanation.recognized[0]).toMatchObject({ questionId: 'event_type', optionIds: ['wedding'] })
    expect(sim.turns[1].explanation.recognized[0].text).toBeUndefined()
  })

  it('reads in the owner\'s words, with "not decided" said plainly', () => {
    const m = toBuilder(pp)
    const sim = simulateConversation(pp, [['היי'], ['חתונה'], ['לא נקבע']])
    expect(explainRecognized(m, sim.turns[1].explanation)).toEqual(['סוג האירוע / השירות: חתונה'])
    expect(explainRecognized(m, sim.turns[2].explanation)).toEqual(['תאריך האירוע: טרם נקבע'])
  })
})

// ── Preview parity ───────────────────────────────────────────────────────────

describe('the live preview is production output, not an approximation', () => {
  it.each([
    ['agency 158', pp],
    ['agency 103', pilot],
  ])('%s: the opening is exactly what the simulator (production decision code) sends first', (_, d) => {
    const view = deriveEditorView(toBuilder(d))
    const sent = simulateConversation(d, [['היי']]).turns[0].replies[0]
    expect(view.opening).toBe(sent)
    expect(view.opening).toBe(finalizeCustomerFacingText(renderOpening(d, d.steps[0])))
  })

  it('every question shows exactly what the worker renders for it', () => {
    const view = deriveEditorView(toBuilder(pp))
    for (const step of pp.steps) expect(view.messages[step.id]).toBe(finalizeCustomerFacingText(renderQuestion(step)))
  })

  it('a branch shown in the preview is the message the simulator sends on that branch', () => {
    const view = deriveEditorView(toBuilder(pp))
    const sim = simulateConversation(pp, [['היי'], ['רחפן']])
    expect(sim.turns[1].replies[0]).toBe(view.messages['drone_city'])
  })

  it('custom endings are the endings production sends', () => {
    const view = deriveEditorView(toBuilder(pp))
    expect(view.endings.custom).toEqual(pp.closingVariants!.map((v) => finalizeCustomerFacingText(v.text)))
    expect(view.endings.custom[2]).toContain('https://wisepage.wwcrm.co.il/picture-perfect')
  })

  it('unsaved new questions preview immediately, under their ref', () => {
    const m = addQuestion(salon())
    const added = m.questions[2]
    const typed = updateQuestion(m, keyOf(added), { prompt: 'מה התקציב?' })
    expect(deriveEditorView(typed).messages[keyOf(added)]).toContain('מה התקציב?')
  })

  it('a dash the owner types is shown as it will be sent, not flagged as an error', () => {
    const m = updateQuestion(salon(), 'date', { prompt: 'לאיזה תאריך - בערך?' })
    const view = deriveEditorView(m)
    expect(view.messages['date']).toBe('לאיזה תאריך, בערך?')
    expect(view.ready).toBe(true)
  })

  it('problems are attached to the card and option they belong to', () => {
    let m = addQuestion(salon())
    const added = keyOf(m.questions[2])
    m = updateQuestion(m, added, { label: 'תקציב' })
    const view = deriveEditorView(m)
    expect(view.ready).toBe(false)
    expect(view.issues[added].some((i) => i.code === 'missing_text' && i.field === 'prompt')).toBe(true)
    expect(view.issues[added].filter((i) => i.optionId).length).toBe(2)
    expect(view.issues[added].every((i) => !/[a-z_]{4,}/.test(i.text))).toBe(true)
  })

  it('a custom ending with no answer ticked gets its own clear problem', () => {
    const m = addEnding(salon(), { questionId: 'service', anyOf: [] })
    const view = deriveEditorView(m)
    expect(view.endingIssues[0]?.[0]).toMatchObject({ code: 'condition_needs_answer' })
    expect(view.endingIssues[0]?.[0].text).toContain('לפחות תשובה אחת')
  })
})

// ── Editor operations ────────────────────────────────────────────────────────

describe('editor operations', () => {
  it('reorders with up/down, and never past either end', () => {
    const m = salon()
    expect(moveQuestion(m, 'date', -1).questions.map(keyOf)).toEqual(['date', 'service'])
    expect(moveQuestion(m, 'service', -1)).toBe(m)
    expect(moveQuestion(m, 'date', 1)).toBe(m)
  })

  it('choice ⇄ choice keeps the options; leaving choice drops them and releases what depended on them', () => {
    let m = setShownWhen(salon(), 'date', { questionId: 'service', anyOf: ['hair'] })
    m = setAnswerKind(m, 'service', 'multi_choice')
    expect(optionsOf(q(m, 'service')).map(keyOf)).toEqual(['hair', 'nails'])
    expect(dependentsOf(m, 'service').questions).toEqual(['date'])
    m = setAnswerKind(m, 'service', 'text')
    expect(q(m, 'service').answer).toEqual({ kind: 'text', notSetAllowed: false })
    expect(q(m, 'date').shownWhen).toEqual({ mode: 'always' })
  })

  it('free text ⇄ choice: messages exist only for free text', () => {
    let m = updateQuestion(salon(), 'date', { messages: { notUnderstood: 'לא הבנו' } })
    m = setAnswerKind(m, 'date', 'single_choice')
    expect(q(m, 'date').messages).toEqual({})
    expect(optionsOf(q(m, 'date'))).toHaveLength(2)
  })

  it('"not decided yet" is a switch on checked text answers', () => {
    const m = setNotSetAllowed(salon(), 'date', false)
    expect(q(m, 'date').answer).toEqual({ kind: 'date', notSetAllowed: false })
  })

  it('options: a new one goes above "אחר"; an emptied icon is no icon; phrasings stay separate from the label', () => {
    let m = enableOther(salon(), 'service')
    m = addOption(m, 'service')
    const labels = optionsOf(q(m, 'service')).map((o) => o.label)
    expect(labels[labels.length - 1]).toBe('אחר')
    m = updateOption(m, 'service', 'hair', { icon: '' })
    expect(optionsOf(q(m, 'service'))[0]).not.toHaveProperty('icon')
    m = updateOption(m, 'service', 'hair', { label: 'תספורת', icon: '✂️', phrasings: ['להסתפר'] })
    expect(optionsOf(q(m, 'service'))[0]).toMatchObject({ label: 'תספורת', icon: '✂️', phrasings: ['להסתפר'] })
    expect(deriveEditorView(m).messages['service']).toContain('1. תספורת ✂️')
  })

  it('removing an answer removes it from conditions; a condition left with none means "always"', () => {
    let m = setShownWhen(salon(), 'date', { questionId: 'service', anyOf: ['hair'] })
    m = addEnding(m, { questionId: 'service', anyOf: ['hair', 'nails'] })
    m = removeOption(m, 'service', 'hair')
    expect(q(m, 'date').shownWhen).toEqual({ mode: 'always' })
    expect(m.endings.custom[0].sentWhen.conditions[0].anyOf).toEqual(['nails'])
  })

  it('removing a question releases its dependents and drops endings that only depended on it', () => {
    let m = setShownWhen(salon(), 'date', { questionId: 'service', anyOf: ['hair'] })
    m = addEnding(m, { questionId: 'service', anyOf: ['hair'] })
    expect(dependentsOf(m, 'service')).toEqual({ questions: ['date'], endings: [0] })
    m = removeQuestion(m, 'service')
    expect(m.questions.map(keyOf)).toEqual(['date'])
    expect(q(m, 'date').shownWhen).toEqual({ mode: 'always' })
    expect(m.endings.custom).toEqual([])
  })

  it('"אחר" on and off: option + follow-up in, both out, nothing dangling', () => {
    const on = enableOther(salon(), 'service')
    const other = otherOf(on, 'service')!
    expect(on.questions.map(keyOf).indexOf(keyOf(other.followUp!))).toBe(1)
    expect(describeCondition(on, conditionOf(other.followUp!))).toBe('שירות הוא אחר')
    expect(enableOther(on, 'service')).toBe(on)
    expect(disableOther(on, 'service')).toEqual(salon())
  })

  it('conditions only offer earlier choice questions', () => {
    expect(conditionSources(salon(), 'date').map(keyOf)).toEqual(['service'])
    expect(conditionSources(salon(), 'service')).toEqual([])
  })

  it('endings: edit, reorder, remove', () => {
    let m = addEnding(salon(), { questionId: 'service', anyOf: ['hair'] })
    m = addEnding(m, { questionId: 'service', anyOf: ['nails'] })
    m = updateEnding(m, 0, { message: 'לתספורת: https://example.com' })
    m = moveEnding(m, 0, 1)
    expect(m.endings.custom.map((e) => e.message)).toEqual([salon().endings.standard, 'לתספורת: https://example.com'])
    expect(deriveEditorView(m).endings.custom[1]).toBe('לתספורת: https://example.com')
  })
})

// ── Real questionnaires through the editor ───────────────────────────────────

describe('Perfect Picture (agency 158) through the editor, unpublished', () => {
  const m = toBuilder(pp)
  const view = deriveEditorView(m)

  it('loads ready, with nothing to fix and nothing normalized away', () => {
    expect(view.ready).toBe(true)
    expect(Object.values(view.issues).flat()).toEqual([])
    const res = assignIds(pp, m)
    if (res.ok === false) throw new Error(res.error.code)
    expect(res.assigned).toEqual({})
    expect(toDefinition(res.questionnaire, pp.revision)).toEqual({ ok: true, definition: pp })
  })

  it('event types: icons separate from labels, customer phrasings kept', () => {
    const wedding = optionsOf(q(m, 'event_type')).find((o) => o.id === 'wedding')!
    expect(wedding).toMatchObject({ label: 'חתונה', icon: '💍' })
    expect(wedding.phrasings).toContain('מתחתנים')
  })

  it('both "אחר" follow-ups are recognised as such', () => {
    expect(otherOf(m, 'event_type')?.followUp?.id).toBe('event_other')
    expect(otherOf(m, 'service')?.followUp?.id).toBe('service_other')
  })

  it('conditional questions read as sentences', () => {
    expect(describeCondition(m, conditionOf(q(m, 'event_date_celebration')))).toBe(
      'סוג האירוע / השירות הוא חתונה, בר / בת מצווה, ברית / בריתה או חינה',
    )
    expect(describeCondition(m, conditionOf(q(m, 'drone_permit')))).toBe('סוג האירוע / השירות הוא צילום רחפן / נדל״ן')
    expect(describeCondition(m, conditionOf(q(m, 'service_other')))).toBe('בשאלה "שירות צילום" נבחר אחר')
  })

  it('date / location with "not decided", multi-select services, the drone branch, and three conditional endings', () => {
    expect(q(m, 'event_date_celebration').answer).toEqual({ kind: 'date', notSetAllowed: true })
    expect(q(m, 'event_location').answer).toEqual({ kind: 'text', notSetAllowed: true })
    expect(q(m, 'event_location').messages.notUnderstood).toContain('מיקום')
    expect(q(m, 'service').answer.kind).toBe('multi_choice')
    expect(['drone_city', 'drone_permit', 'drone_date'].every((id) => conditionOf(q(m, id))?.anyOf.join() === 'drone')).toBe(true)
    expect(m.endings.custom.map((e) => describeCondition(m, e.sentWhen.conditions[0]))).toEqual([
      'סוג האירוע / השירות הוא צילום רחפן / נדל״ן',
      'סוג האירוע / השירות הוא בר / בת מצווה או חינה',
      'סוג האירוע / השירות הוא חתונה',
    ])
  })
})

describe('agency 103 through the editor, unpublished', () => {
  it('loads ready and saves back byte-identical, with no ids assigned and nothing rewritten', () => {
    const m = toBuilder(pilot)
    expect(deriveEditorView(m).ready).toBe(true)
    const res = assignIds(pilot, m)
    if (res.ok === false) throw new Error(res.error.code)
    expect(res.assigned).toEqual({})
    expect(toDefinition(res.questionnaire, pilot.revision)).toEqual({ ok: true, definition: pilot })
    // Unchecked free text stays unchecked: no forced migration to a newer check.
    expect(m.questions.find((x) => x.id === 'business_field')!.answer).toEqual({ kind: 'text_unchecked' })
  })
})

// ── Browser safety ───────────────────────────────────────────────────────────

describe('the editor domain is browser-safe', () => {
  it('imports nothing but zod (no database, no node built-ins, no secrets)', () => {
    const root = process.cwd()
    const seen = new Set<string>()
    const external = new Set<string>()
    const resolve = (from: string, spec: string): string | null => {
      if (!spec.startsWith('@/') && !spec.startsWith('.')) {
        external.add(spec)
        return null
      }
      const base = spec.startsWith('@/') ? path.join(root, spec.slice(2)) : path.resolve(path.dirname(from), spec)
      for (const c of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) if (fs.existsSync(c)) return c
      return null
    }
    const walk = (file: string) => {
      if (seen.has(file)) return
      seen.add(file)
      const src = fs.readFileSync(file, 'utf8')
      for (const m of src.matchAll(/^(?:import|export)\s(?!type\b)[^'"]*?from\s+['"]([^'"]+)['"]/gm)) {
        const next = resolve(file, m[1])
        if (next) walk(next)
      }
    }
    const dir = path.join(root, 'lib/inbox/autoresponse/questionnaire/builder')
    for (const f of ['editorView.ts', 'editorOps.ts', 'conditionText.ts', 'explainText.ts']) walk(path.join(dir, f))
    expect([...external]).toEqual(['zod'])
    expect([...seen].some((f) => f.includes('config/db') || f.endsWith('/ids.ts'))).toBe(false)
  })
})
