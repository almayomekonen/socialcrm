/**
 * A short reply that names no option, on a question that has "אחר": that is
 * the customer's "אחר", in their own words ("צילום אירועים"). Pure.
 *
 * SHORT ONLY (≤ 6 words). A longer reply is kept against the question and the
 * customer is asked which option is closest (readTurn.ts); it is never filed
 * as "אחר" on our guess. Never a question, a correction, filler, a number, a
 * reply about "all", or a reply in which a phrasing matched.
 */
import { aliasTokens, matchAliases } from './aliasMatch'
import { mentionsAll } from './allKeyword'
import type { QuestionnaireChoiceStep } from './definition'
import { otherOptionOf } from './otherOption'
import { normalizeForMatch } from './parseAnswer'
import { isCorrection, isFillerOnly, isQuestionToUs } from './validateAnswer'

export const OTHER_FALLBACK_MAX_WORDS = 6

export function readAsOther(text: string, step: QuestionnaireChoiceStep): { optionId: string; raw: string } | null {
  const other = otherOptionOf(step)
  if (!other || /[?؟]/.test(text ?? '')) return null
  const words = aliasTokens(text)
  if (!words.length || words.length > OTHER_FALLBACK_MAX_WORDS) return null
  if (words.some((w) => /^\d+$/.test(w)) || mentionsAll(text)) return null
  if (isFillerOnly(text) || isCorrection(words) || isQuestionToUs(text, words)) return null
  if (matchAliases(text, step, { natural: true }).length > 0) return null
  return { optionId: other.id, raw: normalizeForMatch(text).slice(0, 300) }
}
