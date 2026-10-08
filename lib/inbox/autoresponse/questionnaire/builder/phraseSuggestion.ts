/**
 * "השאלון לא זיהה את הניסוח הזה. ללמד אותו?" — a Builder-only suggestion shown
 * beside the test chat when a customer's words were not recognised.
 *
 * NOT MATCHING LOGIC. The runtime decides what a customer's message means;
 * nothing here changes that or is ever used for a real customer. This only
 * proposes a phrase for the owner to add, and only when it is safe:
 *
 *   1. exactly one answer's name appears whole inside the message (the
 *      longest wins: "איפור ושיער" over "איפור"); and
 *   2. the RUNTIME's own parser (parseChoice) recognises the message as that
 *      answer once the phrase is added; and
 *   3. the questionnaire's own check finds no clash with another answer.
 *
 * Anything less certain proposes nothing. Adding the phrase is the owner's
 * click; the draft is never changed silently.
 */
import { aliasTokens } from '../aliasMatch'
import type { QuestionnaireChoiceStep, QuestionnaireDefinition } from '../definition'
import { parseChoice } from '../parseAnswer'
import { checkDefinitionForPublish } from './checks'

export type PhraseSuggestion = { questionId: string; optionId: string; optionLabel: string; phrase: string }

const MAX_PHRASE = 40

function containsWords(words: string[], part: string[]): boolean {
  if (!part.length || part.length > words.length) return false
  for (let i = 0; i + part.length <= words.length; i++) {
    if (part.every((p, k) => words[i + k] === p)) return true
  }
  return false
}

export function suggestPhrase(definition: QuestionnaireDefinition, questionId: string, message: string): PhraseSuggestion | null {
  const step = definition.steps.find((s) => s.id === questionId)
  const phrase = message.trim().replace(/\s+/g, ' ')
  if (!step || step.type !== 'choice' || !phrase || phrase.length > MAX_PHRASE || /[?؟]/.test(phrase)) return null

  const words = aliasTokens(phrase)
  const named = step.options
    .map((o) => ({ option: o, parts: aliasTokens(o.label) }))
    .filter((c) => containsWords(words, c.parts))
  if (!named.length) return null
  const longest = Math.max(...named.map((c) => c.parts.length))
  const best = named.filter((c) => c.parts.length === longest)
  if (best.length !== 1) return null
  const { option } = best[0]
  // Already a phrase of this answer: nothing to teach.
  if ((option.aliases ?? []).some((a) => aliasTokens(a).join(' ') === words.join(' '))) return null

  const taught: QuestionnaireChoiceStep = {
    ...step,
    options: step.options.map((o) => (o.id === option.id ? { ...o, aliases: [...(o.aliases ?? []), phrase] } : o)),
  }
  const parsed = parseChoice(phrase, taught)
  if (!parsed.ok || parsed.optionIds.length !== 1 || parsed.optionIds[0] !== option.id) return null

  const after = { ...definition, steps: definition.steps.map((s) => (s.id === step.id ? taught : s)) }
  const clash = checkDefinitionForPublish(after).issues.some((i) => i.questionId === step.id && i.code === 'phrasing_on_two_options')
  if (clash) return null

  return { questionId: step.id, optionId: option.id, optionLabel: option.label, phrase }
}
