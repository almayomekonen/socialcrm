import { isSupportCategory, type SupportCategory, type SupportErrorCode } from './vocabulary'

/**
 * Hand-written validators returning typed reason codes — the house convention.
 * zod exists in this repo but is used only for AI structured output; the action
 * layer speaks {ok, reason} so the client can translate without parsing errors.
 *
 * THE ACTION-LAYER HALF OF THE THREE-LAYER BODY CONTRACT lives here:
 *
 *   Database  support/system messages always carry content (CHECK constraint)
 *   ACTION    an empty customer body is valid ONLY when a context resolved  <-- this file
 *   UI        Phase 2 skips empty-bodied messages rather than rendering a blank
 *
 * The database deliberately cannot enforce the middle rule: it has no way to
 * know whether resolution actually happened, and a `context` column on the
 * parent request is not proof that THIS submission came from that flow. So the
 * two layers are complementary, not redundant, and neither substitutes for the
 * other.
 *
 * The product reason: when SocialCRM has already resolved "החיבור ל-WhatsApp
 * נותק", demanding a paragraph that repeats it is exactly the friction this
 * feature exists to remove. When it has resolved nothing, the customer is the
 * only source of information and must tell us something.
 */

const SUBJECT_MAX = 200
const BODY_MIN_WITHOUT_CONTEXT = 10
const BODY_MAX = 5000

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; reason: SupportErrorCode }

/**
 * Validates the ONE thing the customer actually typed.
 *
 * Subject and category are no longer inputs: the customer is never asked to
 * write a subject line or classify their own problem. The action derives both
 * (lib/support/derive.ts) and this function's job is reduced to the single
 * question that matters — did they tell us enough to act on?
 */
export function validateNewRequest(input: {
  body: string
  /**
   * Whether the SERVER resolved a context for this request. Derived from the
   * resolver result, never from a client claim — a caller cannot assert
   * "I have context" to skip the body requirement.
   */
  hasContext: boolean
}): ValidationResult<{ body: string }> {
  // Trimmed BEFORE the length checks, so whitespace can never fake a body — and
  // so a whitespace-only body with context normalises to '' rather than being
  // stored as blanks that later render as an empty bubble.
  const body = (input.body ?? '').trim()
  if (body.length > BODY_MAX) return { ok: false, reason: 'invalid_body' }
  if (!input.hasContext && body.length < BODY_MIN_WITHOUT_CONTEXT) {
    return { ok: false, reason: 'invalid_body' }
  }

  return { ok: true, value: { body } }
}

/**
 * Guards the DERIVED subject before it reaches the column. Not a customer-facing
 * validation — the customer cannot supply a subject — but the schema's NOT NULL
 * and length limits are still real, and a derivation bug should fail loudly here
 * rather than at the database.
 */
export function assertDerivedSubject(subject: string): ValidationResult<string> {
  const trimmed = (subject ?? '').trim()
  if (trimmed.length === 0 || trimmed.length > SUBJECT_MAX) {
    return { ok: false, reason: 'invalid_subject' }
  }
  return { ok: true, value: trimmed }
}

/** Same role as above, for the derived category. */
export function assertDerivedCategory(category: string): ValidationResult<SupportCategory> {
  if (!isSupportCategory(category)) return { ok: false, reason: 'invalid_category' }
  return { ok: true, value: category }
}

/**
 * A reply always requires content, in both modes. There is no context attached
 * to a reply, so there is nothing that could carry the meaning in its place.
 */
export function validateReplyBody(body: string): ValidationResult<string> {
  const trimmed = (body ?? '').trim()
  if (trimmed.length === 0 || trimmed.length > BODY_MAX) {
    return { ok: false, reason: 'invalid_body' }
  }
  return { ok: true, value: trimmed }
}
