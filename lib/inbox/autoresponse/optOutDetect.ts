/**
 * "Stop messaging me", in one place, with no model anywhere near it.
 *
 * These patterns used to live in `qualify.ts`, which also owns the model call.
 * Anything that wanted the compliance check — including the deterministic
 * questionnaire, which must be able to prove it cannot reach a model — had to
 * import the generator to get it.
 *
 * So the vocabulary moved here and `qualify.ts` re-exports it. One definition
 * of an opt-out for the whole product, reachable without pulling in the AI
 * router. Nothing about the detection changed.
 */

const OPTOUT_PATTERNS: RegExp[] = [
  /תפסיק|תפסיקו|הסר אותי|להסיר|תורידו אותי|אל תכתבו|אל תשלח|הפסיקו|לא רוצה לקבל הודע/,
  /\bstop\b|unsubscribe|remove me|opt[ -]?out|leave me alone|do not (contact|message)/i,
]

/**
 * Plural and second-person imperatives asking to be taken off the list.
 *
 * The list above carries `הסר אותי` (singular imperative) and `להסיר`
 * (infinitive), but not `הסירו` or `תסירו` — so "הסירו אותי" and "תסירו אותי
 * מהרשימה", both ordinary ways to ask, were NOT opt-outs. The agent would have
 * kept replying, including with a courtesy line.
 *
 * Deliberately narrow: the removal verb must be paired with a first-person
 * object (אותי / אותנו) or an explicit list. "תסירו את הכתם" is not an opt-out,
 * and neither is a rep discussing removing somebody else.
 */
const REMOVAL_PATTERNS: RegExp[] = [
  /(?:הסירו|הסירי|תסירו|תסיר|תורידו|תוריד)\s+אות(?:י|נו)(?:\s|$|[.,!?])/,
  /(?:הסירו|הסירי|תסירו|תסיר|להסיר)[^.!?\n]{0,24}מ(?:ה?רשימה|ה?תפוצה|ה?דיוור)/,
]

/**
 * Quoted spans, removed before the removal patterns are tested, so a message
 * ABOUT the phrase is not treated as the phrase — "לקוח כתב לי 'הסירו אותי'".
 * Applied ONLY to the patterns added here: the pre-existing list is a compliance
 * stop and loosening it is not this change's business.
 */
const QUOTED_SPAN = /["'״’«][^"'״’»\n]{0,80}["'״’»]/g

/** Customer opt-out / unsubscribe request → permanent stop + compliance. */
export function detectOptOut(text: string): boolean {
  const t = text ?? ''
  if (OPTOUT_PATTERNS.some((re) => re.test(t))) return true
  return REMOVAL_PATTERNS.some((re) => re.test(t.replace(QUOTED_SPAN, ' ')))
}
