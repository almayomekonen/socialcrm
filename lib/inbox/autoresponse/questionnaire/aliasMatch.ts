/**
 * Reading a natural answer to a choice question, deterministically.
 *
 * A business may list `aliases` on an option: the words its customers actually
 * use for it ("בערב", "אחרי העבודה"). A reply that contains an alias of
 * exactly one option selects that option. Nothing here calls a model, and the
 * vocabulary lives in the business's definition, not in code.
 *
 * WHAT COUNTS AS CONTAINING. Whole words only, compared after the same
 * normalisation on both sides. The first word of an alias may carry up to two
 * Hebrew prefix letters (ו ה ב ל מ ש כ), so "בערב", "והערב" and "לסוף השבוע"
 * match without the owner listing every form. A handful of everyday words that
 * only look like a prefixed alias are never read that way (FALSE_FRIENDS).
 *
 * WHAT DOES NOT. A reply that matches two different options is not a selection:
 * "בבוקר או בערב" is a person deciding, and choosing for them is the guess
 * this questionnaire exists to avoid. It re-prompts like any unreadable answer.
 */
import type { QuestionnaireChoiceStep } from './definition'

const PREFIX_RE = /^[והבלמשכ]{1,2}$/

/**
 * Words that are a prefix plus an alias in spelling only: "מבחינה" (in terms
 * of) is not "חינה", and the United States is not a ברית.
 */
const FALSE_FRIENDS = new Set(['בחינה', 'מבחינה', 'לבחינה', 'הבחינה', 'ובחינה', 'שבחינה'])
const FALSE_FRIEND_PHRASES: ReadonlyArray<readonly [string, string]> = [['ארצות', 'הברית']]

/** Lowercase, strip niqqud and punctuation (incl. maqaf and slash), split into words. */
export function aliasTokens(text: string): string[] {
  return (text ?? '')
    .toLowerCase()
    .replace(/[֑-ֽֿ-ׇ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
}

function wordMatches(word: string, alias: string, first: boolean, previous: string | undefined): boolean {
  if (word === alias) return true
  if (!first || word.length <= alias.length || !word.endsWith(alias)) return false
  if (!PREFIX_RE.test(word.slice(0, word.length - alias.length))) return false
  if (FALSE_FRIENDS.has(word)) return false
  return !FALSE_FRIEND_PHRASES.some(([before, after]) => word === after && (previous ?? '').endsWith(before))
}

function containsAlias(words: readonly string[], alias: readonly string[]): boolean {
  if (!alias.length) return false
  for (let i = 0; i + alias.length <= words.length; i++) {
    if (alias.every((part, j) => wordMatches(words[i + j], part, j === 0, words[i + j - 1]))) return true
  }
  return false
}

export function stepHasAliases(step: QuestionnaireChoiceStep): boolean {
  return step.options.some((o) => (o.aliases?.length ?? 0) > 0)
}

/** The ids of every option whose alias appears in the text, in menu order. */
export function matchAliases(text: string, step: QuestionnaireChoiceStep): string[] {
  const words = aliasTokens(text)
  if (!words.length) return []
  return step.options
    .filter((option) => (option.aliases ?? []).some((alias) => containsAlias(words, aliasTokens(alias))))
    .map((option) => option.id)
}
