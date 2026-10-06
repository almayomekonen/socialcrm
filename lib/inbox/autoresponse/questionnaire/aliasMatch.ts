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
 * Nor does a match with a negation just before it ("לא צריך וידאו"). The one
 * exception is a negation that is itself part of a listed phrase: when phrases
 * overlap the longest wins, so "לא יודע" is that answer and not also a "לא".
 */
import type { z } from 'zod'
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

type Hit = { optionId: string; start: number; end: number }

/** Every position at which the alias phrase starts in the reply. */
function aliasStarts(words: readonly string[], alias: readonly string[]): number[] {
  const starts: number[] = []
  if (!alias.length) return starts
  for (let i = 0; i + alias.length <= words.length; i++) {
    if (alias.every((part, j) => wordMatches(words[i + j], part, j === 0, words[i + j - 1]))) starts.push(i)
  }
  return starts
}

/**
 * Negation the customer wrote, as a whole word. A negation inside a phrase we
 * matched ("לא יודע", "אין לי") is that phrase, not a negation of something else.
 */
const NEGATIONS = new Set(['לא', 'ולא', 'שלא', 'אין', 'ואין', 'שאין', 'בלי', 'ובלי', 'ללא', 'חוץ'])
const NEGATION_REACH = 3

export function stepHasAliases(step: QuestionnaireChoiceStep): boolean {
  return step.options.some((o) => (o.aliases?.length ?? 0) > 0)
}

/**
 * The ids of every option the reply names, in menu order. Empty when it names
 * none, or when a negation sits just before a match ("לא צריך וידאו"), because
 * reading past a "no" is exactly the guess we refuse to make.
 */
export function matchAliases(text: string, step: QuestionnaireChoiceStep): string[] {
  const words = aliasTokens(text)
  if (!words.length) return []
  const hits: Hit[] = []
  for (const option of step.options) {
    for (const alias of option.aliases ?? []) {
      const parts = aliasTokens(alias)
      for (const start of aliasStarts(words, parts)) hits.push({ optionId: option.id, start, end: start + parts.length })
    }
  }
  // The longest phrase wins: "לא" inside "לא יודע" is not also a "לא".
  const kept = hits.filter(
    (h) => !hits.some((o) => o.start <= h.start && o.end >= h.end && o.end - o.start > h.end - h.start),
  )
  const covered = (i: number) => kept.some((h) => i >= h.start && i < h.end)
  const negated = kept.some((h) => {
    for (let i = Math.max(0, h.start - NEGATION_REACH); i < h.start; i++) {
      if (NEGATIONS.has(words[i]) && !covered(i)) return true
    }
    return false
  })
  if (negated) return []
  return step.options.filter((o) => kept.some((h) => h.optionId === o.id)).map((o) => o.id)
}

/** One alias, two options: a reply containing it would select neither. */
export function checkAliasCollisions(step: QuestionnaireChoiceStep, index: number, ctx: z.RefinementCtx): void {
  const aliasOwner = new Map<string, string>()
  step.options.forEach((option, optionIndex) => {
    for (const alias of option.aliases ?? []) {
      const key = aliasTokens(alias).join(' ')
      if (!key) {
        ctx.addIssue({
          code: 'custom',
          message: `empty alias in option '${option.id}' of step '${step.id}'`,
          path: ['steps', index, 'options', optionIndex, 'aliases'],
        })
        continue
      }
      const owner = aliasOwner.get(key)
      if (owner && owner !== option.id) {
        ctx.addIssue({
          code: 'custom',
          message: `alias '${alias}' belongs to both '${owner}' and '${option.id}' in step '${step.id}'`,
          path: ['steps', index, 'options', optionIndex, 'aliases'],
        })
      }
      aliasOwner.set(key, option.id)
    }
  })
}
