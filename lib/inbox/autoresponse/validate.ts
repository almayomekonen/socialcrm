/**
 * Deterministic guardrail for auto-response text. The model is NEVER trusted to
 * self-police — this pure function is the last gate before send.
 *
 * WHAT THIS GUARDS, AND WHAT IT DELIBERATELY NO LONGER GUARDS.
 *
 * The rule is: the agent must not COMMIT on the business's behalf, and must not
 * invent facts. The rule is NOT that the agent may never say the word
 * "appointment". Those were the same list until now, and the conflation cost
 * real conversations: `פגיש` is a substring, so it also matched פגישה / פגישות /
 * לפגישה, and a clinic, a garage, a barber or a dentist could not acknowledge
 * the single most common thing their customers write about. Two generations
 * later the job skipped as `validation_failed` and the customer got silence —
 * the one outcome that costs the owner the lead.
 *
 * So the guardrail now matches COMMITMENT SHAPES, not vocabulary:
 *   · "I've booked you for…", "you're confirmed for…"   → rejected
 *   · "מתי נוח לך שנתאם פגישה?"                          → allowed
 *   · a number quoted as a price ("₪450", "450 שקל")     → rejected
 *   · an ordinary number ("דגם 3", "רחוב הרצל 12")        → allowed
 *
 * Grounding — whether a stated time or price actually appears in the business's
 * saved information — is the prompt's job and the owner's job, not this
 * function's: a pure string check cannot know what a given clinic charges.
 * What this function guarantees is narrower and checkable: nothing leaves here
 * that PROMISES, CONFIRMS, or reports a completed action.
 *
 * NOTE: JavaScript's `\b` word boundary is ASCII-only and never matches before a
 * Hebrew letter, so Hebrew terms are matched as plain substrings. English terms
 * keep `\b` to avoid matching inside larger words.
 */

/** An explicit price figure: currency symbol/word adjacent to digits. */
const PRICE_FIGURE = [
  /[₪$€]\s*\d/,
  /\d\s*[₪$€]/,
  /\d[\d,.]*\s*(?:ש"ח|ש״ח|שקל|שקלים|אלף|dollars?|euros?|usd|ils)/i,
  /(?:מחיר|עלות|עולה|price|costs?)\D{0,12}\d/i,
  /\d\D{0,12}(?:לחודש|לשנה|לטיפול|per month|per year|a month)/i,
]

/** Discounts and promotions are a commercial promise the agent cannot make. */
const DISCOUNT = [/הנחה/, /מבצע/, /\bdiscount\b/i, /\bspecial offer\b/i, /\bpromo(?:tion)?\b/i]

/**
 * Commitment shapes. The agent may DISCUSS scheduling; it may not CONFIRM it.
 * First person + a booking/confirming verb, or an explicit guarantee.
 */
const COMMITMENT = [
  // Hebrew: "קבעתי / אקבע / נקבע / שריינתי / רשמתי אותך / אישרתי"
  /קבעתי|אקבע|נקבע לך|קבענו לך|שריינתי|שריינו לך|רשמתי אותך|רשמנו אותך|אישרתי|אישרנו לך|הזמנתי עבורך/,
  /התור שלך (?:נקבע|אושר|שמור)/,
  /הזמנתך (?:אושרה|נקלטה)/,
  // Hebrew guarantees
  /מבטיח|מבטיחה|מבטיחים|מתחייב|מתחייבת|מתחייבים/,
  // English
  /\b(?:i(?:'ve| have)?|we(?:'ve| have)?)\s+(?:booked|scheduled|reserved|confirmed|signed you up|registered you)/i,
  /\byour (?:appointment|booking|slot) (?:is|has been) (?:confirmed|booked|reserved|set)/i,
  /\b(?:guarantee|guaranteed|i promise|we promise)\b/i,
]

/**
 * Claiming an action the agent cannot perform. It has no tools: it never sends
 * anything, files anything, or updates anything.
 */
const FABRICATED_ACTION = [
  /שלחתי לך|שלחנו לך|צירפתי|העברתי את הפרטים ל(?!צוות)|פתחתי לך|יצרתי לך/,
  /\bi(?:'ve| have)? (?:sent|attached|emailed|created|opened|filed) (?:you|your)/i,
]

const ALL_FORBIDDEN_GROUPS: ReadonlyArray<readonly RegExp[]> = [
  PRICE_FIGURE,
  DISCOUNT,
  COMMITMENT,
  FABRICATED_ACTION,
]

/**
 * Retained as a named export: existing callers and tests import FORBIDDEN, and
 * the flat list is still the honest answer to "what does this reject?".
 */
export const FORBIDDEN: RegExp[] = ALL_FORBIDDEN_GROUPS.flatMap((g) => [...g])

function firstForbiddenMatch(t: string): string | null {
  for (const re of FORBIDDEN) {
    if (re.test(t)) return re.source
  }
  return null
}

/** Diagnostic metrics for a validated reply — observability only, never gates. */
export interface ValidationDetails {
  /** Trimmed length actually evaluated. */
  length: number
  /** Sentence count (split on . ! ? and newlines). */
  sentenceCount: number
  /** Number of question marks. */
  questionMarks: number
  /** Source of the first FORBIDDEN pattern that matched, or null. */
  matchedForbidden: string | null
}

export type ValidationResult =
  | { ok: true; details: ValidationDetails }
  | { ok: false; violation: string; details: ValidationDetails }

/** Discovery/deepen still prefer a question. Product/explain/next-step may answer without one. */
export type QuestionPolicy = 'require_one' | 'zero_or_one'

export function questionPolicyForSalesMove(
  move: string | null | undefined,
  opts?: { discoveryBudgetExhausted?: boolean },
): QuestionPolicy {
  if (opts?.discoveryBudgetExhausted && (move === 'DISCOVERY' || move === 'DEEPEN' || !move)) {
    return 'zero_or_one'
  }
  if (move === 'DISCOVERY' || move === 'DEEPEN' || !move) return 'require_one'
  return 'zero_or_one'
}

/** Ordinary turn. */
const MAX_SENTENCES = 3
const MAX_CHARS = 320
/**
 * Greeting turn. "Hi, welcome to X 👋" + an answer + one question is exactly
 * three sentences and lands on the ordinary limit, so any clause that needs a
 * comma tips it over and the greeting turn — the one turn that must not fail —
 * becomes the most likely to. One sentence and 80 characters of headroom.
 */
const MAX_SENTENCES_GREETING = 4
const MAX_CHARS_GREETING = 400

export function validateAutoResponse(
  text: string,
  opts?: { questionPolicy?: QuestionPolicy; greetingTurn?: boolean },
): ValidationResult {
  const t = (text ?? '').trim()
  const policy = opts?.questionPolicy ?? 'require_one'
  const maxSentences = opts?.greetingTurn ? MAX_SENTENCES_GREETING : MAX_SENTENCES
  const maxChars = opts?.greetingTurn ? MAX_CHARS_GREETING : MAX_CHARS
  const sentences = t
    .split(/[.!?\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  const questionMarks = (t.match(/\?/g) ?? []).length
  const matchedForbidden = firstForbiddenMatch(t)
  const details: ValidationDetails = { length: t.length, sentenceCount: sentences.length, questionMarks, matchedForbidden }

  if (!t) return { ok: false, violation: 'empty', details }
  if (sentences.length > maxSentences) return { ok: false, violation: 'too_long', details }
  if (t.length > maxChars) return { ok: false, violation: 'too_long', details }
  if (policy === 'require_one' && questionMarks === 0) return { ok: false, violation: 'no_question', details }
  if (questionMarks > 1) return { ok: false, violation: 'too_many_questions', details }
  if (matchedForbidden) return { ok: false, violation: 'forbidden', details }
  return { ok: true, details }
}

/** Category of a validation violation, used to route repair vs handoff. */
export type ViolationKind = 'safety' | 'shape'

/**
 * Classify a validation `violation` for repair routing:
 * - 'safety' — the reply breached the FORBIDDEN price/time/commitment guardrail;
 *   a human must take over (may escalate after a failed regeneration).
 * - 'shape'  — a formatting problem (`too_many_questions`, `too_long`,
 *   `no_question`, `empty`) that is repaired by one regeneration or a
 *   deterministic next-field question, and NEVER escalates.
 * This does not weaken the guardrail — it only categorises an already-decided
 * violation. FORBIDDEN and all thresholds are unchanged.
 */
export function classifyViolation(violation: string): ViolationKind {
  return violation === 'forbidden' ? 'safety' : 'shape'
}

/**
 * Post-handoff (concierge) validator. Shares the FORBIDDEN price/time/commitment
 * guardrail and the length limits with {@link validateAutoResponse}, but DROPS
 * the "exactly one question" rule — a post-handoff reply is usually an
 * acknowledgement or a deferral ("בשמחה", "אחד מאנשי הצוות יחזור אליך"), not a
 * qualification question. Same conservative stance: reject on doubt.
 */
export function validateConciergeReply(text: string): ValidationResult {
  const t = (text ?? '').trim()
  const sentences = t
    .split(/[.!?\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  const questionMarks = (t.match(/\?/g) ?? []).length
  const matchedForbidden = firstForbiddenMatch(t)
  const details: ValidationDetails = { length: t.length, sentenceCount: sentences.length, questionMarks, matchedForbidden }

  if (!t) return { ok: false, violation: 'empty', details }
  if (sentences.length > 3) return { ok: false, violation: 'too_long', details }
  if (t.length > 320) return { ok: false, violation: 'too_long', details }
  if (matchedForbidden) return { ok: false, violation: 'forbidden', details }
  return { ok: true, details }
}
