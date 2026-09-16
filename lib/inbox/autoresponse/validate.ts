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
 *   · an ordinary number ("דגם 3", "רחוב הרצל 12")        → allowed
 *
 * AND IT CHECKS GROUNDING, rather than trusting the prompt for it. A price
 * figure or a process claim (a demo, a signup) is allowed only when it appears
 * in that business's own saved facts, which the caller passes as
 * `groundedFacts`. A clinic whose settings say "טיפול פנים 450 ש״ח" can quote
 * 450; one whose settings mention no price cannot produce a number at all. That
 * is how "discuss prices when grounded in business information" and "never
 * invent one" are both satisfied by a pure function.
 *
 * What never becomes groundable: a discount, a confirmed booking, a claimed
 * action. Those are promises the agent makes, not facts it quotes, so no
 * configuration can license them.
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

/**
 * An assertion ABOUT price that quotes no figure — "המחיר שלנו משתלם מאוד".
 * It commits to nothing, but it is still a claim about the business that the
 * agent has no standing to make. Permitted when the reply is an honest
 * limitation ("I have no verified price"), which is the answer we want.
 */
const PRICE_CLAIM = /מחיר|עלות/
const HONEST_PRICE_LIMITATION =
  /אין לי .{0,24}מחיר|מחיר מאומת|מחיר מדויק|לא רוצה להמציא.{0,20}מחיר|נציג .{0,48}(?:את )?המחיר|בלי לנקוב.{0,16}מחיר/

/**
 * An onboarding process the business may not have: a demo, a signup, a form.
 * Inventing one sends the customer somewhere that does not exist.
 */
const PROCESS_CLAIM = [/הדגמה/, /(?:^|[\s,.;:])דמו(?:$|[\s,.;:])/, /\bdemo\b/i, /להירשם|הרשמה באתר/, /sign ?up/i]

const ALL_FORBIDDEN_GROUPS: ReadonlyArray<readonly RegExp[]> = [
  PRICE_FIGURE,
  DISCOUNT,
  COMMITMENT,
  FABRICATED_ACTION,
  PROCESS_CLAIM,
]

/**
 * Retained as a named export: existing callers and tests import FORBIDDEN, and
 * the flat list is still the honest answer to "what does this reject?".
 */
export const FORBIDDEN: RegExp[] = [...ALL_FORBIDDEN_GROUPS.flatMap((g) => [...g]), PRICE_CLAIM]

/**
 * GROUNDING, MADE CHECKABLE.
 *
 * The brief asks for two things that pull against each other: let a business
 * discuss its own prices, dates and processes, and never let the agent invent
 * one. A pure string check cannot know what a clinic charges — but it CAN check
 * whether the thing the reply just said appears in that business's saved facts.
 *
 * So a price figure or a process claim is allowed when it is present in the
 * owner's own configuration, and refused otherwise. A clinic whose settings say
 * "טיפול פנים 450 ש״ח" can quote 450; one whose settings say nothing about
 * price cannot produce a number at all.
 *
 * Absent facts mean nothing is grounded, which is the safe direction: the
 * guardrail behaves exactly as it would for a business that configured nothing.
 */
function isGrounded(matched: string, text: string, facts: string | null | undefined): boolean {
  const haystack = (facts ?? '').toLowerCase()
  if (!haystack) return false
  const digits = text.match(/\d[\d,.]*/g) ?? []
  if (digits.length) {
    // Every number the reply used must appear in the business's own facts.
    return digits.every((d) => haystack.includes(d.replace(/[.,]$/, '')))
  }
  return haystack.includes(matched.toLowerCase())
}

function firstForbiddenMatch(t: string, facts?: string | null): string | null {
  for (const group of ALL_FORBIDDEN_GROUPS) {
    for (const re of group) {
      const m = t.match(re)
      if (!m) continue
      // PRICE_FIGURE and PROCESS_CLAIM may be grounded in the business's facts.
      // DISCOUNT, COMMITMENT and FABRICATED_ACTION never can be: a discount, a
      // confirmed booking and a claimed action are promises, not facts to quote.
      const groundable = group === PRICE_FIGURE || group === PROCESS_CLAIM
      if (groundable && isGrounded(m[0], t, facts)) continue
      return re.source
    }
  }
  if (PRICE_CLAIM.test(t) && !HONEST_PRICE_LIMITATION.test(t) && !isGrounded('מחיר', t, facts)) {
    return PRICE_CLAIM.source
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
  opts?: {
    questionPolicy?: QuestionPolicy
    greetingTurn?: boolean
    /**
     * The business's own saved information. A price figure or a process claim is
     * allowed only when it appears here — see {@link isGrounded}. Omitted ⇒
     * nothing is grounded, which is the safe default.
     */
    groundedFacts?: string | null
  },
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
  const matchedForbidden = firstForbiddenMatch(t, opts?.groundedFacts)
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
export function validateConciergeReply(text: string, groundedFacts?: string | null): ValidationResult {
  const t = (text ?? '').trim()
  const sentences = t
    .split(/[.!?\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  const questionMarks = (t.match(/\?/g) ?? []).length
  const matchedForbidden = firstForbiddenMatch(t, groundedFacts)
  const details: ValidationDetails = { length: t.length, sentenceCount: sentences.length, questionMarks, matchedForbidden }

  if (!t) return { ok: false, violation: 'empty', details }
  if (sentences.length > MAX_SENTENCES) return { ok: false, violation: 'too_long', details }
  if (t.length > MAX_CHARS) return { ok: false, violation: 'too_long', details }
  if (matchedForbidden) return { ok: false, violation: 'forbidden', details }
  return { ok: true, details }
}
