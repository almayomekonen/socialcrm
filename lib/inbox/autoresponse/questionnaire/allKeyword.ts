/**
 * "הכל" as an answer to a multi-select question. Pure.
 *
 * WHOLE MESSAGE ONLY. "הכל", "כולם", "את הכל" (a trailing "תודה" allowed) are
 * a selection; "לא הכל", "כמעט הכל", "הכל חוץ מ…", "הכל בסדר" and "הכל?" are
 * not, and nothing here tries to subtract an exclusion: a customer who wrote
 * one is asked again, never answered for.
 *
 * ONLY WHERE THE OWNER SAID SO. `acceptsAll` on the question (definition.ts).
 * "אחר"-type options are never part of "all": something not listed is not
 * part of everything listed.
 */
import { aliasTokens } from './aliasMatch'
import type { QuestionnaireChoiceStep } from './definition'

const ALL_PHRASES = new Set(['הכל', 'הכול', 'כולם', 'כולן', 'את הכל', 'את הכול', 'כל האפשרויות', 'all'])
const ALL_WORDS = new Set(['הכל', 'הכול', 'כולם', 'כולן'])
const THANKS = new Set(['תודה', 'רבה'])
const OTHER_LIKE = /(^|\s)(אחר|אחרת|אחרים|אחרות)(\s|$)/

export function isAllKeyword(text: string): boolean {
  if (/[?؟]/.test(text ?? '')) return false
  const words = aliasTokens(text)
  while (words.length > 1 && THANKS.has(words[words.length - 1])) words.pop()
  return ALL_PHRASES.has(words.join(' '))
}

/** Any "all" word at all: such a reply is about the menu, never an "אחר" value. */
export function mentionsAll(text: string): boolean {
  return aliasTokens(text).some((w) => ALL_WORDS.has(w))
}

export function allOptionIds(step: QuestionnaireChoiceStep): string[] | null {
  if (step.multi !== true || step.acceptsAll !== true) return null
  const ids = step.options.filter((o) => !OTHER_LIKE.test(o.label.trim())).map((o) => o.id)
  return ids.length >= 2 ? ids : null
}
