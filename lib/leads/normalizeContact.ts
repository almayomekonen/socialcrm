/**
 * Centralized contact normalization for duplicate detection.
 *
 * The phone logic mirrors the inline normalization already used by the
 * Facebook/WhatsApp webhooks and the CSV import, so detection agrees with how
 * data was written. This helper is used ONLY by the duplicate-detection path —
 * the existing inline normalizers are intentionally left untouched (V1 makes no
 * webhook/import changes). Manually-entered leads are NOT normalized on write,
 * so callers must normalize BOTH the query and the stored value when comparing.
 */

/** → `972XXXXXXXXX` for Israeli numbers, or `972`-prefixed for anything 9+ digits. Returns null when too short to be a real number. */
export function normalizePhone(raw: string | null | undefined): string | null {
  const digits = raw?.replace(/\D/g, '') ?? ''
  if (digits.length < 9) return null
  return digits.startsWith('972') ? digits : '972' + digits.replace(/^0/, '')
}

/** The 9 significant (national) digits — the stable part shared across `0`-prefixed and `972`-prefixed variants. */
export function phoneCore(raw: string | null | undefined): string | null {
  const normalized = normalizePhone(raw)
  if (!normalized) return null
  const core = normalized.slice(-9)
  return core.length === 9 ? core : null
}

/** Lowercased, trimmed email, or null when empty. */
export function normalizeEmail(raw: string | null | undefined): string | null {
  const email = raw?.trim().toLowerCase() ?? ''
  return email.length ? email : null
}

/** Digits-only, left-padded to 9 (matching how `getLeadByIdNum` looks up by idNum). */
export function normalizeIdNum(raw: string | null | undefined): string | null {
  const digits = raw?.replace(/\D/g, '') ?? ''
  if (!digits.length) return null
  return digits.padStart(9, '0')
}
