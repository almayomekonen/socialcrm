/**
 * Israeli phone normalization for WhatsApp recipients.
 *
 * This module is DELIBERATELY Israel-specific. It is NOT a general phone
 * normalizer and must not be treated as one: it recognizes the Israeli local
 * number format and only rewrites numbers that positively match it.
 */

/** Israel country calling code (E.164), without '+'. */
export const IL_COUNTRY_CODE = '972'

/**
 * A valid Israeli local number: leading '0', a service digit (2-9), then 8 more
 * digits — 10 total (mobile 05X, VoIP 07X, etc.). The service-digit guard
 * rejects '00…'/'01…'; the exact length rejects short strings and 9-digit forms.
 * This is what stops arbitrary '0…' strings being rewritten.
 */
const ISRAELI_LOCAL_PATTERN = /^0[2-9]\d{8}$/

/**
 * Convert a phone number to a WhatsApp recipient id (E.164 without '+'),
 * ASSUMING ISRAELI local numbering — and only when the input is a VALIDATED
 * Israeli local number.
 *
 *  - matches ISRAELI_LOCAL_PATTERN → leading '0' replaced with 972.
 *  - anything else                → returned unchanged (already-E.164,
 *    non-Israeli international, or an unrecognized string that merely starts
 *    with '0'). We never rewrite a number we cannot positively identify.
 *
 * Idempotent: normalizing an already-normalized value returns it unchanged.
 */
export function toIsraeliWhatsappRecipient(raw: string): string {
  const digits = String(raw ?? '').replace(/\D/g, '')
  if (ISRAELI_LOCAL_PATTERN.test(digits)) return IL_COUNTRY_CODE + digits.slice(1)
  return digits
}
