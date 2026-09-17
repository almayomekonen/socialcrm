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
/**
 * A claim that the request has been, or is being, handed to a person.
 *
 * ONLY TRUE ON AN ESCALATING TURN. Production transcript, 11:59: the customer
 * accepted an offered transfer, the agent wrote "אעביר את הפנייה לצוות ואציין
 * שביקשת שיחזרו אלייך בהקדם" — and nothing was transferred. decidePostGeneration
 * had returned `send`, so there was no escalation, no operator summary and no
 * state change behind the sentence.
 *
 * Note FABRICATED_ACTION below carries `/העברתי את הפרטים ל(?!צוות)/` — a
 * negative lookahead that deliberately EXEMPTED "…לצוות". That exemption is what
 * let the claim through. It is kept for every other fabricated action; this rule
 * covers the transfer case and is lifted only when the turn really escalates.
 */
const TRANSFER_CLAIM = [
  /אעביר|העברתי|מעביר(?:ה)? (?:את )?(?:ה?פנייה|ה?פרטים|אותך)|אמסור ל?צוות|אעדכן את הצוות|מעבירה? לצוות/,
  /\b(?:i(?:'ll| will)? (?:pass|forward|hand)(?: this| it| you| the request)?|i(?:'ve| have) (?:passed|forwarded|handed))\b/i,
]

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
/**
 * Saying "I have no price" or "I can't confirm a price" is the answer we WANT.
 * The refusal branch was added after a real-model run: the agent replied
 * "אני לא יכול לאשר הזמנת טיסה או מחיר לטיסה" to a jailbreak — an exemplary
 * refusal — and the guardrail rejected it as a price claim, because only the
 * "I don't have" phrasings were recognised. Declining is strictly safer than
 * limiting, so it must pass at least as easily.
 */
const HONEST_PRICE_LIMITATION = new RegExp(
  [
    // "I don't have a price / a verified price / an exact price"
    'אין לי .{0,24}מחיר',
    'אין (?:לי )?כאן .{0,24}מחיר',
    'מחיר מאומת',
    'מחיר מדויק',
    'לא רוצה להמציא.{0,20}מחיר',
    'בלי לנקוב.{0,16}מחיר',
    // "a rep / the team will give you the price"
    'נציג .{0,48}(?:את )?המחיר',
    '(?:הצוות|צוות) .{0,48}מחיר',
    'הצעות מחיר .{0,32}(?:רק|במוסך|בעסק|אצלנו)',
    // Refusals: "I can't quote / confirm / give a price"
    '(?:לא יכול|לא יכולה|לא ניתן|אי אפשר)[^.!?]{0,40}מחיר',
    'מחיר[^.!?]{0,40}(?:לא יכול|לא יכולה|לא ניתן|אי אפשר)',
    // English equivalents
    "(?:don't|do not|cannot|can't)[^.!?]{0,40}\\b(?:price|quote|cost)",
    "no (?:verified |exact )?price",
  ].join('|'),
)

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

/**
 * A complete turn that legitimately carries no question mark.
 *
 * `require_one` exists to stop a discovery turn dead-ending. It is implemented
 * as "must contain a '?'", and that proxy is right almost always — but not when
 * the honest answer is a limitation. Real-model evaluation produced:
 *
 *   "הגעת למוסך אלון, ואנחנו לא מציעים טיפולי פנים."
 *
 * A correct, complete reply, rejected for punctuation and then replaced by a
 * generic canned question — a worse message for the customer than the one the
 * model wrote.
 *
 * DELIBERATELY NARROW. An earlier attempt accepted any sufficiently long reply,
 * and that silently weakened three unrelated protections which had been leaning
 * on `no_question`: the banned "I'm transferring you to the team" line, a
 * product answer that must still ask in discovery, and generic filler. Stating
 * a limitation is the one case where no question is genuinely complete, so it
 * is the only exemption. Everything else keeps going through the repair loop,
 * which is what that loop is for.
 */
const STATES_LIMITATION = new RegExp(
  [
    'אין לי',
    'אין לנו',
    'לא יכול|לא יכולה|לא ניתן|אי אפשר',
    'אנחנו לא מציעים|איננו מציעים|לא מציעים',
    'לא עוסקים ב|לא מטפלים ב',
    "\\b(?:i|we) (?:don't|do not|cannot|can't)\\b",
    '\\bno (?:verified |exact )?price\\b',
    "\\bwe (?:don't|do not) offer\\b",
  ].join('|'),
  'i',
)

/** True when a reply with no question is nonetheless a complete turn. */
export function movesForward(text: string): boolean {
  return STATES_LIMITATION.test((text ?? '').trim())
}

/**
 * Generic filler the system prompt already bans, encoded so it fails
 * deterministically rather than depending on the model to police itself.
 *
 * It used to be caught incidentally by `no_question` — a "welcome, we're here to
 * help, tell us a bit about yourself" reply has no question mark AND says
 * nothing. It is worth failing by its own name: the problem is that it is
 * filler, not that it is missing punctuation. The phrases are multi-word so an
 * ordinary offer of help does not trip them.
 */
const GENERIC_FILLER = new RegExp(
  [
    '(?:אנחנו|אני) (?:פה|כאן) כדי לעזור',
    // The vague self-introduction request, not any "tell me more". Asking a
    // customer to say more about THEIR NEED is a good question; asking them to
    // describe themselves is the boilerplate. An earlier, looser version of this
    // rejected one of the engine's own fallbacks, which is how the distinction
    // surfaced.
    'ספר(?:י)? (?:לי|לנו) (?:עוד )?קצת על (?:עצמך|העסק שלך|מה שאתה מחפש|מה שאת מחפשת)',
    'כדי שנוכל להבין',
    'נעים להכיר',
    'איזה כיף',
    '\\bhere to help\\b',
    "\\btell (?:me|us) a (?:bit|little) about (?:yourself|your business|what you(?:'re| are) looking for)\\b",
  ].join('|'),
  'i',
)

/** True when the reply is the boilerplate the prompt forbids. */
export function isGenericFiller(text: string): boolean {
  return GENERIC_FILLER.test(text ?? '')
}


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
     * This turn is the escalation itself, so a transfer claim is true. Every
     * other turn may not claim one — see TRANSFER_CLAIM.
     */
    escalating?: boolean
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
  if (isGenericFiller(t)) return { ok: false, violation: 'filler', details }
  if (policy === 'require_one' && questionMarks === 0 && !movesForward(t)) {
    return { ok: false, violation: 'no_question', details }
  }
  if (questionMarks > 1) return { ok: false, violation: 'too_many_questions', details }
  if (!opts?.escalating && TRANSFER_CLAIM.some((re) => re.test(t))) {
    return { ok: false, violation: 'unsupported_transfer_claim', details }
  }
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
  // A claimed transfer is a truthfulness failure, not a shape one, so it gets
  // the safety path: regenerate once, and if the model insists, hand to a human
  // — which is what the customer was being promised anyway.
  return violation === 'forbidden' || violation === 'unsupported_transfer_claim' ? 'safety' : 'shape'
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
