/**
 * Click-to-WhatsApp / referral detection.
 *
 * Fail-safe: anything missing or malformed is NOT a CTWA signal.
 * Never guess from message text. The customer never sees this word.
 */

export function hasCtwaReferral(rawMessage: unknown): boolean {
  if (!rawMessage || typeof rawMessage !== 'object') return false
  const referral = (rawMessage as { referral?: unknown }).referral
  if (!referral || typeof referral !== 'object') return false

  const rec = referral as Record<string, unknown>
  if (typeof rec.ctwa_clid === 'string' && rec.ctwa_clid.trim().length > 0) return true
  if (rec.source_type === 'ad') return true
  return false
}
