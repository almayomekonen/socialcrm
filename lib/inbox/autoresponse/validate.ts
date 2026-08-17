/**
 * Deterministic guardrail for auto-response text. The model is NEVER trusted to
 * self-police — this pure function is the last gate before send. Reject on any
 * doubt; the worker then skips-to-human rather than sending.
 *
 * NOTE: JavaScript's `\b` word boundary is ASCII-only and never matches before a
 * Hebrew letter, so Hebrew terms are matched as plain substrings (conservative:
 * a false-reject is safe — silence — while a false-accept is not). English terms
 * keep `\b` to avoid matching inside larger words.
 *
 * The word מחיר is forbidden unless the reply is an honest limitation (no
 * verified price). Digits, currency, discounts, and commitments still fail.
 */
const HONEST_PRICE_LIMITATION =
  /אין לי .{0,24}מחיר|מחיר מאומת|לא רוצה להמציא.{0,20}מחיר|נציג .{0,48}(?:את )?המחיר|בלי לנקוב.{0,16}מחיר/

const PRICE_WORD = /מחיר/

export const FORBIDDEN = [
  // currency / price / quotes — numeric and currency stay hard-fail.
  // The word מחיר is handled in firstForbiddenMatch (honest limitation allowed).
  /[₪$€]/,
  /ש"ח/,
  /ש״ח/,
  /שקל/,
  /עלות/,
  /כמה עולה/,
  /הצעת מחיר/,
  /\bprice\b/i,
  /\bcost\b/i,
  // discounts
  /הנחה/,
  /מבצע/,
  /\bdiscount\b/i,
  /\bdeal\b/i,
  // availability / time commitments / appointments
  /זמין/,
  /שעה/,
  /מחר/,
  /נקבע/,
  /אקבע/,
  /פגיש/,
  /\bavailable\b/i,
  /\bappointment\b/i,
  // commitments / guarantees
  /מבטיח/,
  /מתחייב/,
  /\bguarantee/i,
  /\bpromise\b/i,
  // fabricated onboarding that is not a verified product capability
  /הדגמה/,
  /(?:^|[\s,.;:])דמו(?:$|[\s,.;:])/,
  /\bdemo\b/i,
  /sign ?up/i,
  /להירשם/,
  // bare digits that look like price/time (2+ digits)
  /\d{2,}/,
]

function firstForbiddenMatch(t: string): string | null {
  if (PRICE_WORD.test(t) && !HONEST_PRICE_LIMITATION.test(t)) return PRICE_WORD.source
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

export function questionPolicyForSalesMove(move: string | null | undefined): QuestionPolicy {
  if (move === 'DISCOVERY' || move === 'DEEPEN' || !move) return 'require_one'
  return 'zero_or_one'
}

export function validateAutoResponse(
  text: string,
  opts?: { questionPolicy?: QuestionPolicy },
): ValidationResult {
  const t = (text ?? '').trim()
  const policy = opts?.questionPolicy ?? 'require_one'
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
