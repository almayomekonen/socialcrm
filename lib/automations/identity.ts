/**
 * Customer email identity resolution (ADR-013) — pure, no I/O.
 *
 * ONE resolver serves both the worker's sends and the UI's test-send: a test
 * email that could differ from a real one would defeat its entire purpose.
 *
 * V1 model: platform-managed From address on the engine sending domain
 * (ADR-002), the business's name as display name, the business's real address
 * as Reply-To. Customers cannot set the From address — that refusal is what
 * keeps the platform from being usable for spoofing.
 */

export const DEFAULT_DISPLAY_NAME = 'העסק'

export type SenderIdentity = {
  /** RFC 5322 From header value: quoted display name + engine address. */
  from: string
  displayName: string
  replyTo: string
}

export type IdentityProblem = 'no_sending_domain' | 'no_reply_to'

/**
 * Deliberately a nullable-field pair rather than a discriminated union: this
 * repo compiles with `strictNullChecks: false`, under which `ok: true|false`
 * discriminants do not narrow reliably. `problem` non-null ⇔ `identity` null.
 */
export type IdentityResolution = {
  identity: SenderIdentity | null
  problem: IdentityProblem | null
}

// C0 controls (incl. CR/LF) and DEL — the header-injection vector. Built from
// a pattern string so no literal control byte ever appears in this source.
const CONTROL_PATTERN = '[\\u0000-\\u001f\\u007f]'
const CONTROL_CHARS_GLOBAL = new RegExp(CONTROL_PATTERN, 'g')
const CONTROL_CHARS = new RegExp(CONTROL_PATTERN)

/**
 * The display name is the ONLY identity element sourced from user-entered
 * data, so it is untrusted input on a header line. Stripping control
 * characters is injection defense, not cosmetics.
 */
export function sanitizeDisplayName(raw: string | null | undefined): string {
  const cleaned = (raw ?? '').replace(CONTROL_CHARS_GLOBAL, ' ').replace(/\s+/g, ' ').trim()
  return cleaned || DEFAULT_DISPLAY_NAME
}

/** Always quoted and escaped — safe for names containing RFC 5322 specials. */
export function formatFromHeader(displayName: string, address: string): string {
  const escaped = displayName.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return `"${escaped}" <${address}>`
}

/** Single address only: no lists, no angle brackets, no header continuation. */
export function isValidReplyTo(value: string | null | undefined): boolean {
  const v = (value ?? '').trim()
  if (!v || v.length > 254) return false
  if (CONTROL_CHARS.test(v)) return false
  if (/[,;<>"\s]/.test(v)) return false
  return /^[^@]+@[^@.]+(\.[^@.]+)+$/.test(v)
}

export type IdentityFacts = {
  /** Business display name source. */
  agencyName: string | null
  /** Agency-configured reply-to, else the admin's account email. */
  replyTo: string | null
}

/**
 * Resolve the identity, or report precisely why it cannot be completed.
 * Incompleteness is a CONFIGURATION fault: callers must treat it as
 * definitive (never a transient retry), per ADR-013.
 */
export function resolveSenderIdentity(facts: IdentityFacts, fromAddress: string): IdentityResolution {
  const address = (fromAddress ?? '').trim()
  if (!address) return { identity: null, problem: 'no_sending_domain' }

  const replyTo = (facts.replyTo ?? '').trim()
  // The engine does not send mail whose replies vanish (spec: replies land in
  // the owner's normal inbox; email is not an in-product channel).
  if (!isValidReplyTo(replyTo)) return { identity: null, problem: 'no_reply_to' }

  const displayName = sanitizeDisplayName(facts.agencyName)
  return {
    identity: { from: formatFromHeader(displayName, address), displayName, replyTo },
    problem: null,
  }
}

/** Hebrew copy for the דורש טיפול card state (spec §8 failure surface). */
export const IDENTITY_PROBLEM_COPY: Record<IdentityProblem, string> = {
  no_sending_domain: 'שליחת אימיילים אינה מוגדרת עדיין. נדרשת בדיקה בהגדרות החשבון.',
  no_reply_to: 'חסרה כתובת אימייל לתשובות. יש להשלים אותה בהגדרות העסק.',
}
