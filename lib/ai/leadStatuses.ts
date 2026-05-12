/**
 * Single source of truth for lead-status classification used across the
 * follow-up rule engine and the copilot context layer.
 *
 * Both modules previously declared these sets independently with a comment
 * cross-referencing each other ("if you change one, audit the other"). That
 * coupling is unsafe — extracting it here makes the contract explicit and
 * the call sites narrower.
 */

/** Statuses that close the lead — copilot suppresses suggestions, follow-up
 *  rule engine returns null. */
export const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  'לא רלוונטי',
  'לא מעוניין',
  'סגורה',
  'הסתיים טיפול',
  'הועבר לנציג אחר',
])

/** Statuses that indicate active engagement requiring follow-up vigilance. */
export const ACTIVE_STATUSES: ReadonlySet<string> = new Set(['חדש', 'בטיפול', 'ממתין לתשובה'])
