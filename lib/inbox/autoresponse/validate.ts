/**
 * Deterministic guardrail for auto-response text. The model is NEVER trusted to
 * self-police — this pure function is the last gate before send. Reject on any
 * doubt; the worker then skips-to-human rather than sending.
 *
 * NOTE: JavaScript's `\b` word boundary is ASCII-only and never matches before a
 * Hebrew letter, so Hebrew terms are matched as plain substrings (conservative:
 * a false-reject is safe — silence — while a false-accept is not). English terms
 * keep `\b` to avoid matching inside larger words.
 */
const FORBIDDEN = [
  // currency / price / quotes
  /[₪$€]/, /ש"ח/, /שקל/, /מחיר/, /עלות/, /כמה עולה/, /הצעת מחיר/, /\bprice\b/i, /\bcost\b/i,
  // discounts
  /הנחה/, /מבצע/, /\bdiscount\b/i, /\bdeal\b/i,
  // availability / time commitments / appointments
  /זמין/, /שעה/, /מחר/, /נקבע/, /אקבע/, /פגיש/, /\bavailable\b/i, /\bappointment\b/i,
  // commitments / guarantees
  /מבטיח/, /מתחייב/, /\bguarantee/i, /\bpromise\b/i,
  // bare digits that look like price/time (2+ digits)
  /\d{2,}/,
]

export function validateAutoResponse(text: string): { ok: true } | { ok: false; violation: string } {
  const t = (text ?? '').trim()
  if (!t) return { ok: false, violation: 'empty' }
  // sentence count (split on . ! ? and newlines)
  const sentences = t.split(/[.!?\n]+/).map((s) => s.trim()).filter(Boolean)
  if (sentences.length > 3) return { ok: false, violation: 'too_long' }
  if (t.length > 320) return { ok: false, violation: 'too_long' }
  const questionMarks = (t.match(/\?/g) ?? []).length
  if (questionMarks === 0) return { ok: false, violation: 'no_question' }
  if (questionMarks > 1) return { ok: false, violation: 'too_many_questions' }
  for (const re of FORBIDDEN) if (re.test(t)) return { ok: false, violation: 'forbidden' }
  return { ok: true }
}
