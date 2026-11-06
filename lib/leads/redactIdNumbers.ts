/**
 * Mask Israeli ID numbers (ת"ז) in free text before it leaves for an AI
 * provider.
 *
 * Two rules, both deliberately narrow so ordinary numbers in a note (prices,
 * phone numbers, dates, quantities) survive:
 *   1. the lead's OWN id number, wherever it appears, in any length it was
 *      stored in;
 *   2. any standalone 9-digit run that passes the ת"ז check digit. Mobile
 *      numbers are 10 digits (05X…) and never match; a 9-digit landline
 *      (02…, 03…) matches only in the ~1 in 10 cases its digits happen to
 *      satisfy the checksum, and is then masked too: losing a phone number in
 *      an AI prompt is the cheap side of that trade.
 */

export const ID_MASK = '[ת"ז הוסתר]'

/** The ת"ז check digit: alternate weights 1,2; digits of each product summed; total % 10 === 0. */
export function isValidIsraeliId(digits: string): boolean {
  if (!/^\d{5,9}$/.test(digits)) return false
  const padded = digits.padStart(9, '0')
  let sum = 0
  for (let i = 0; i < 9; i++) {
    const n = Number(padded[i]) * ((i % 2) + 1)
    sum += n > 9 ? n - 9 : n
  }
  return sum % 10 === 0
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function redactIdNumbers(text: string, knownIds: Array<string | null | undefined> = []): string {
  let out = text
  for (const raw of knownIds) {
    const id = typeof raw === 'string' ? raw.trim() : ''
    if (id.length < 5) continue
    out = out.replace(new RegExp(`(?<!\\d)${escapeRegExp(id)}(?!\\d)`, 'g'), ID_MASK)
  }
  return out.replace(/(?<!\d)\d{9}(?!\d)/g, (m) => (isValidIsraeliId(m) ? ID_MASK : m))
}
