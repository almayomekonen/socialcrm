/**
 * A short reply that names no option, on a question that has "אחר": that is
 * the customer's "אחר", in their own words ("צילום אירועים"). Pure.
 *
 * SHORT ONLY (≤ 6 words). A longer reply is kept against the question and the
 * customer is asked which option is closest (readTurn.ts); it is never filed
 * as "אחר" on our guess. Never a question, a correction, filler, a number, a
 * reply about "all", or a reply in which a phrasing matched.
 *
 * NOT A NON-ANSWER (code review 2026-10-13). "אין לי מושג", "השני", "שניהם",
 * "היי אני דני", "אני רוצה הצעת מחיר", "לא וידאו ולא מגנטים" are not a value
 * the business did not list: they are uncertainty, a pointer at the menu, a
 * greeting, a request, or a refusal. Any of these words keeps the reply for the
 * rep instead (readTurn.ts "noted").
 */
import { aliasTokens, matchAliases } from './aliasMatch'
import { EXCLUDING, NEGATING } from './aliasGuards'
import { mentionsAll } from './allKeyword'
import type { QuestionnaireChoiceStep } from './definition'
import { otherOptionOf } from './otherOption'
import { normalizeForMatch } from './parseAnswer'
import { isCorrection, isFillerOnly, isQuestionToUs } from './validateAnswer'

export const OTHER_FALLBACK_MAX_WORDS = 6

/** Pointing at the menu: ordinals, number words, "both", "whatever there is". */
const MENU_POINTERS = new Set([
  'ראשון', 'ראשונה', 'הראשון', 'הראשונה', 'שני', 'השני', 'השנייה', 'השניה', 'שלישי', 'שלישית', 'השלישי', 'השלישית',
  'רביעי', 'רביעית', 'הרביעי', 'הרביעית', 'חמישי', 'חמישית', 'החמישי', 'החמישית', 'שישי', 'שישית', 'השישי', 'השישית',
  'שביעי', 'שמיני', 'תשיעי', 'עשירי', 'אחרון', 'אחרונה', 'האחרון', 'האחרונה',
  'אחד', 'אחת', 'שתיים', 'שתים', 'שניים', 'שלוש', 'שלושה', 'ארבע', 'ארבעה', 'חמש', 'חמישה', 'שש', 'שישה',
  'שבע', 'שבעה', 'שמונה', 'תשע', 'תשעה', 'עשר', 'עשרה',
  'אפשרות', 'האפשרות', 'אופציה', 'האופציה', 'שניהם', 'שתיהן', 'שתיהם', 'וגם', 'כל',
])
/** Not decided, not sure, give me a moment. */
const UNSURE = new Set([
  'מושג', 'בטוח', 'בטוחה', 'בטוחים', 'תלוי', 'החלטתי', 'החלטנו', 'יודע', 'יודעת', 'יודעים', 'בודק', 'בודקת', 'בודקים',
  'שנייה', 'רגע', 'אולי', 'מתלבט', 'מתלבטת', 'מתלבטים',
])
/** Greetings, apologies, assent: talking to us, not answering. */
const SMALL_TALK = new Set([
  'היי', 'הי', 'שלום', 'אהלן', 'הלו', 'סליחה', 'כמובן', 'בטח', 'ברור', 'תודה', 'אוקי', 'אוקיי', 'כן', 'נכון', 'בוקר', 'ערב',
])
/** A request rather than a value: pricing, "I saw the ad". */
const REQUESTS = new Set(['מחיר', 'מחירים', 'הצעת', 'הצעה', 'עולה', 'עלות', 'ראיתי', 'פרסום', 'מודעה', 'פרטים'])

function isNotAnOtherValue(words: readonly string[]): boolean {
  return words.some(
    (w) =>
      NEGATING.has(w) ||
      EXCLUDING.has(w) ||
      MENU_POINTERS.has(w) ||
      UNSURE.has(w) ||
      SMALL_TALK.has(w) ||
      REQUESTS.has(w),
  )
}

export function readAsOther(text: string, step: QuestionnaireChoiceStep): { optionId: string; raw: string } | null {
  const other = otherOptionOf(step)
  if (!other || /[?؟]/.test(text ?? '')) return null
  const words = aliasTokens(text)
  if (!words.length || words.length > OTHER_FALLBACK_MAX_WORDS) return null
  if (words.some((w) => /^\d+$/.test(w)) || mentionsAll(text) || isNotAnOtherValue(words)) return null
  if (isFillerOnly(text) || isCorrection(words) || isQuestionToUs(text, words)) return null
  if (matchAliases(text, step, { natural: true }).length > 0) return null
  return { optionId: other.id, raw: normalizeForMatch(text).slice(0, 300) }
}
