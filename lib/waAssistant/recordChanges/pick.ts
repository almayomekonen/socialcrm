/**
 * WHICH existing task or appointment the owner means. Pure. Never guessed: one
 * clear match is used, anything else is asked about, and the numbered list the
 * owner answers is always the same list, so "2" means the second line they saw.
 */

export const MAX_LISTED = 5
export type Picked<T> = { one: T } | { many: T[] } | { none: true }

const STOP = new Set('את של עם על לי המשימה משימה הפגישה פגישה הזאת הזו הזה'.split(' '))
const ORDINAL_RES = [/^ה?ראשו(?:ן|נה)$/u, /^ה?שני(?:י?ה)?$/u, /^ה?שליש(?:י|ית)$/u, /^ה?רביע(?:י|ית)$/u, /^ה?חמיש(?:י|ית)$/u]
const BARE_YES = /^\s*(כן|נכון|בטח|אוקיי|אוקי|ok|okay|סבבה|זו|זאת|זה)[\s.!]*$/iu

export const contentWords = (text: string): string[] =>
  text
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 1 && !STOP.has(w))

/** How many of `words` appear in `title`, ignoring an attached preposition. */
export function titleScore(title: string, words: readonly string[]): number {
  const t = title.toLocaleLowerCase()
  return words.filter((w) => t.includes(w) || t.includes(w.replace(/^[ולבהשמ]/u, ''))).length
}

/** The zero-based line an answer points at: "2", "השנייה", "המשימה השנייה". */
export function lineOf(answer: string): number | null {
  const parts = answer.trim().split(/\s+/u)
  if (!parts.length || parts.length > 3) return null
  const last = parts[parts.length - 1].replace(/[.!,]+$/u, '')
  if (/^[1-9]$/u.test(last)) return Number(last) - 1
  const i = ORDINAL_RES.findIndex((re) => re.test(last))
  return i >= 0 ? i : null
}

export function pickTarget<T>(all: readonly T[], input: { answer: string | null; match: string | null; score: (item: T, text: string) => number }): Picked<T> {
  if (!all.length) return { none: true }
  const listed = all.slice(0, MAX_LISTED)
  if (input.answer) {
    const line = lineOf(input.answer)
    if (line !== null && listed[line]) return { one: listed[line] }
    if (all.length === 1 && BARE_YES.test(input.answer)) return { one: all[0] }
  }
  const texts = [input.answer, input.match].filter((t): t is string => !!t && contentWords(t).length > 0)
  if (!texts.length) return all.length === 1 ? { one: all[0] } : { many: listed }
  for (const text of texts) {
    const scored = all.map((item) => ({ item, s: input.score(item, text) }))
    const best = Math.max(...scored.map((x) => x.s))
    const top = scored.filter((x) => x.s === best)
    if (best > 0 && top.length === 1) return { one: top[0].item }
  }
  return { many: listed }
}
