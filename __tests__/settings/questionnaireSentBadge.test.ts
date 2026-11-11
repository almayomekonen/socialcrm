import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { renderOpening } from '@/lib/inbox/autoresponse/questionnaire/render'
import { closingFor } from '@/lib/inbox/autoresponse/questionnaire/closing'
import { parseQuestionnaireDefinition } from '@/lib/inbox/autoresponse/questionnaire/definition'

/**
 * "נשלח ללקוח כלשונו" in the questionnaire builder: the badge (`sent`) is on a
 * field exactly when the worker sends that text to the customer unchanged.
 *
 *   builder field          definition       at runtime
 *   opening                welcome          first part of the opening message (renderOpening)
 *   standard ending        closing          the closing message (closingFor)
 *   custom ending message  closingVariants  the closing message when its condition holds
 *   handoff message        handoff          sent on every handoff (transition.ts)
 *   summary title          summaryTitle     rep-facing summary note only — never sent
 */

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')
/** The props of the AutoResponseTextField whose label is `labelKey`. */
function fieldProps(file: string, labelKey: string): string {
  const src = read(`components/settings/questionnaire/${file}`)
  const at = src.indexOf(`label={t('${labelKey}')}`)
  expect(at, `${labelKey} in ${file}`).toBeGreaterThan(-1)
  return src.slice(at, src.indexOf('/>', at))
}
const sent = (props: string) => /^\s+sent\s*$/m.test(props)
const notSent = (props: string) => props.includes('sent={false}')

describe('the badge flags in the builder', () => {
  it.each([
    ['EditorColumn.tsx', 'admin.questionnaire.editor.openingLabel'],
    ['EndingsSection.tsx', 'admin.questionnaire.endings.standard'],
    ['EndingsSection.tsx', 'admin.questionnaire.endings.message'],
    ['ExtraMessages.tsx', 'admin.questionnaire.extra.handoff'],
  ])('%s %s: sent verbatim → badge', (file, key) => {
    expect(sent(fieldProps(file, key))).toBe(true)
  })

  it('the summary title is rep-facing → no badge', () => {
    expect(notSent(fieldProps('ExtraMessages.tsx', 'admin.questionnaire.extra.summary'))).toBe(true)
  })
})

describe('the runtime facts behind the flags', () => {
  const def = parseQuestionnaireDefinition(read('scripts/questionnaire/samples/perfect-picture.he.json'))
  if (!def.ok) throw new Error('sample definition does not parse')
  const d = def.definition

  it('the opening message starts with the welcome text, unchanged', () => {
    expect(renderOpening(d, d.steps[0]).startsWith(`${d.welcome}\n`)).toBe(true)
  })

  it('the closing message is the ending text itself (standard or the matching custom one)', () => {
    expect(closingFor({ ...d, closing: 'סיום רגיל', closingVariants: [] }, {})).toBe('סיום רגיל')
    const when = { step: 'event_type', anyOf: ['wedding'] }
    const withVariant = { ...d, closing: 'סיום רגיל', closingVariants: [{ when, text: 'סיום לחתונה' }] }
    expect(closingFor(withVariant, { event_type: ['wedding'] })).toBe('סיום לחתונה')
    expect(closingFor(withVariant, { event_type: ['other'] })).toBe('סיום רגיל')
  })

  it('the handoff text is sent as the terminal message, unchanged', () => {
    const transition = read('lib/inbox/autoresponse/questionnaire/transition.ts')
    expect(transition).toContain("terminal('human_request', 'handed_off', definition.handoff,")
  })

  it('the summary title only ever reaches the rep-facing summary', () => {
    const uses = ['render.ts', 'transition.ts', 'finalize.ts', 'effects.ts', 'processJob.ts']
      .map((f) => read(`lib/inbox/autoresponse/questionnaire/${f}`))
      .join('\n')
      .match(/summaryTitle/g)
    // render.ts's renderSummary is the one consumer.
    expect(uses).toHaveLength(2)
    expect(read('lib/inbox/autoresponse/questionnaire/render.ts')).toContain('opts.complete ? definition.summaryTitle')
  })
})
