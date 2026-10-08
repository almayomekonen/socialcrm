import { describe, expect, it } from 'vitest'
import { toBuilder } from '@/lib/inbox/autoresponse/questionnaire/builder/convert'
import { emptyQuestionnaire } from '@/lib/inbox/autoresponse/questionnaire/builder/skeleton'
import { previewDefinition } from '@/lib/inbox/autoresponse/questionnaire/builder/editorView'
import { suggestPhrase } from '@/lib/inbox/autoresponse/questionnaire/builder/phraseSuggestion'
import { simulateConversation } from '@/lib/inbox/autoresponse/questionnaire/builder/simulate'
import { addOption, addPhrasing, setPrompt, updateOption } from '@/lib/inbox/autoresponse/questionnaire/builder/editorOps'
import { applyTextCheck } from '@/components/settings/questionnaire/answerCheck'
import { DATE_PRESET, LOCATION_PRESET } from '@/components/settings/questionnaire/builderCopy'
import type { BuilderQuestionnaire } from '@/lib/inbox/autoresponse/questionnaire/builder/model'

/**
 * "השאלון לא זיהה את הניסוח הזה. ללמד אותו?" — a Builder-only suggestion. It
 * must only ever propose what the RUNTIME will then recognise, and nothing
 * ambiguous; the runtime's matching is not changed.
 */

function salon(): BuilderQuestionnaire {
  let m = toBuilder(emptyQuestionnaire('סלון'))
  m = setPrompt(m, 'request_type', 'איזה שירות מעניין אותך?')
  m = updateOption(m, 'request_type', 'option_1', { label: 'איפור' })
  m = updateOption(m, 'request_type', 'option_2', { label: 'שיער' })
  m = addOption(m, 'request_type')
  const third = m.questions[0].answer.kind === 'single_choice' ? m.questions[0].answer.options[2] : null
  return updateOption(m, 'request_type', third!.ref!, { label: 'איפור ושיער' })
}
const suggest = (m: BuilderQuestionnaire, text: string) => suggestPhrase(previewDefinition(m)!, 'request_type', text)

describe('teaching a phrase from the test chat', () => {
  it('the runtime does not read "אני רוצה איפור" before it is taught (unchanged engine)', () => {
    const sim = simulateConversation(previewDefinition(salon())!, [['היי'], ['אני רוצה איפור']])
    expect(sim.turns[1].explanation.reason).toBe('reprompt_invalid_choice')
  })

  it('suggests the one answer named in the message, and the runtime then recognises it', () => {
    const s = suggest(salon(), 'אני רוצה איפור')
    expect(s).toMatchObject({ optionId: 'option_1', optionLabel: 'איפור', phrase: 'אני רוצה איפור' })
    const taught = addPhrasing(salon(), 'request_type', 'option_1', s!.phrase)
    const sim = simulateConversation(previewDefinition(taught)!, [['היי'], ['אני רוצה איפור']])
    expect(sim.turns[1].explanation.recognized[0]).toMatchObject({ optionIds: ['option_1'] })
  })

  it('the longest name wins: "איפור ושיער" is not "איפור"', () => {
    expect(suggest(salon(), 'אני רוצה איפור ושיער')?.optionLabel).toBe('איפור ושיער')
  })

  it('proposes nothing when nothing is named, when it is a question, or when it is too long', () => {
    expect(suggest(salon(), 'בננה')).toBeNull()
    expect(suggest(salon(), 'יש לכם איפור?')).toBeNull()
    expect(suggest(salon(), `אני רוצה איפור ${'מאוד '.repeat(10)}`)).toBeNull()
  })

  it('proposes nothing already taught, and nothing that would clash with another answer', () => {
    const taught = addPhrasing(salon(), 'request_type', 'option_1', 'אני רוצה איפור')
    expect(suggest(taught, 'אני רוצה איפור')).toBeNull()
    // "שיער" already claims these words: teaching them to "איפור" too would be ambiguous.
    const claimed = addPhrasing(salon(), 'request_type', 'option_2', 'איפור עכשיו')
    expect(suggest(claimed, 'איפור עכשיו')).toBeNull()
  })

  it('never changes the draft by itself', () => {
    const m = salon()
    const before = JSON.stringify(m)
    suggest(m, 'אני רוצה איפור')
    expect(JSON.stringify(m)).toBe(before)
  })
})

describe('"איזו תשובה אנחנו מצפים לקבל?" switches both ways', () => {
  const base = () => applyTextCheck(toBuilder(emptyQuestionnaire('x')), 'request_type', 'meaningful')

  it('date → any answer: back to plain text, the date wording removed', () => {
    const back = applyTextCheck(applyTextCheck(base(), 'request_type', 'date'), 'request_type', 'meaningful')
    expect(back.questions[0].answer.kind).toBe('text')
    expect(back.questions[0].messages.notUnderstood).toBeUndefined()
  })

  it('date → location: the location wording replaces the date wording', () => {
    const loc = applyTextCheck(applyTextCheck(base(), 'request_type', 'date'), 'request_type', 'location')
    expect(loc.questions[0].messages.notUnderstood).toBe(LOCATION_PRESET.notUnderstood)
    expect(loc.questions[0].answer).toEqual({ kind: 'text', notSetAllowed: true })
  })

  it("the owner's own wording is never replaced", () => {
    let m = applyTextCheck(base(), 'request_type', 'date')
    m = { ...m, questions: [{ ...m.questions[0], messages: { notUnderstood: 'כתבו תאריך בבקשה' } }] }
    const loc = applyTextCheck(m, 'request_type', 'location')
    expect(loc.questions[0].messages.notUnderstood).toBe('כתבו תאריך בבקשה')
    expect(DATE_PRESET.notUnderstood).not.toBe('כתבו תאריך בבקשה')
  })
})
