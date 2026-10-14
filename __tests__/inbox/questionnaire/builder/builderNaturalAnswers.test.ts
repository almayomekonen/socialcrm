import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { toBuilder, toDefinition } from '@/lib/inbox/autoresponse/questionnaire/builder/convert'
import { assignIds } from '@/lib/inbox/autoresponse/questionnaire/builder/ids'
import { setAllowAll, setAnswerKind } from '@/lib/inbox/autoresponse/questionnaire/builder/editorOps'
import { checkDefinitionForPublish } from '@/lib/inbox/autoresponse/questionnaire/builder/checks'
import { describeIssue } from '@/lib/inbox/autoresponse/questionnaire/builder/issues'
import { parseQuestionnaireDefinition, type QuestionnaireDefinition } from '@/lib/inbox/autoresponse/questionnaire/definition'
import { naturalDefinition } from '../fixtures/naturalDefinition'

/**
 * "לקוח יכול לענות 'הכל'" in the Builder: the owner's per-question switch for
 * the runtime `acceptsAll` (allKeyword.ts), and the phrasing warnings that
 * keep natural-answer reading honest.
 */

/** The save path: Builder model → ids assigned → runtime definition. */
function save(previous: QuestionnaireDefinition, model: ReturnType<typeof toBuilder>) {
  const ids = assignIds(previous, model)
  if (ids.ok === false) throw new Error(ids.error.code)
  const converted = toDefinition(ids.questionnaire, previous.revision)
  if (converted.ok === false) throw new Error(converted.error.code)
  return converted.definition
}

const SAMPLES = path.join(process.cwd(), 'scripts/questionnaire/samples')
const question = (m: ReturnType<typeof toBuilder>, id: string) => m.questions.find((q) => q.id === id)!

describe('accepts all in the Builder', () => {
  it('survives the save path losslessly', () => {
    const def = naturalDefinition()
    expect(save(def, toBuilder(def))).toEqual(def)
  })
  it('turned on in the editor, it is stored as acceptsAll', () => {
    const def = naturalDefinition()
    const stored = save(def, setAllowAll(toBuilder(def), 'industry', true))
    const industry = stored.steps.find((s) => s.id === 'industry')
    expect(industry?.type === 'choice' && industry.acceptsAll).toBe(true)
  })
  it('is set only on multi-select questions and dropped when the question becomes single', () => {
    let m = toBuilder(naturalDefinition())
    m = setAllowAll(m, 'industry', true)
    expect(question(m, 'industry').answer).toMatchObject({ kind: 'multi_choice', allowAll: true })
    m = setAllowAll(m, 'team', true)
    expect(question(m, 'team').answer).not.toHaveProperty('allowAll')
    m = setAllowAll(m, 'industry', false)
    expect(question(m, 'industry').answer).not.toHaveProperty('allowAll')
    m = setAllowAll(setAnswerKind(setAllowAll(m, 'needs', true), 'needs', 'single_choice'), 'needs', true)
    expect(question(m, 'needs').answer).not.toHaveProperty('allowAll')
  })
})

describe('phrasing warnings', () => {
  const withAliases = (stepId: string, optionIndex: number, aliases: string[]) =>
    naturalDefinition((raw) => {
      const s = raw.steps.find((x) => x.id === stepId) as { options: Array<{ aliases?: string[] }> }
      s.options[optionIndex].aliases = aliases
      return raw
    })
  const codes = (def: QuestionnaireDefinition) => checkDefinitionForPublish(def).issues.map((i) => `${i.code}:${i.severity}`)

  it('warns about a phrasing the engine reads as a request for a person', () => {
    expect(codes(withAliases('team', 0, ['נציג']))).toContain('phrasing_is_command:warning')
  })
  it('warns about a phrasing that is the "all" keyword', () => {
    expect(codes(withAliases('needs', 1, ['הכל']))).toContain('phrasing_is_all:warning')
  })
  it('warns about a lone filler or pronoun', () => {
    expect(codes(withAliases('team', 0, ['אני']))).toContain('phrasing_is_filler:warning')
  })
  it('never warns about the real phrasings, and warnings never block publishing', () => {
    expect(codes(naturalDefinition()).filter((c) => c.startsWith('phrasing_is'))).toEqual([])
    expect(checkDefinitionForPublish(withAliases('team', 0, ['אני', 'נציג'])).ready).toBe(true)
  })
  it('explains each warning in Hebrew', () => {
    const def = withAliases('team', 0, ['אני'])
    const issue = checkDefinitionForPublish(def).issues.find((i) => i.code === 'phrasing_is_filler')!
    expect(describeIssue(issue, toBuilder(def))).toContain('כללי מדי')
  })
})

describe('phrasing warnings on real questionnaires', () => {
  it.each(fs.readdirSync(SAMPLES).filter((f) => f.endsWith('.json')))('%s raises none', (file) => {
    const parsed = parseQuestionnaireDefinition(fs.readFileSync(path.join(SAMPLES, file), 'utf8'))
    if (parsed.ok === false) throw new Error(parsed.errors.join(', '))
    const phrasing = checkDefinitionForPublish(parsed.definition).issues.filter((i) => i.code.startsWith('phrasing_is'))
    expect(phrasing).toEqual([])
  })
})
