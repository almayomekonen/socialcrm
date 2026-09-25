/**
 * Grow requires pageField[fullName] ("Full name must consist of at least two
 * names") and pageField[phone] ("A valid israeli mobile phone number") on the
 * token-save process and on token charges, and forbids special characters in
 * parameters. Grow's production review also checks that the integration
 * validates customer fields BEFORE calling Grow.
 */

export type CardHolderValidation =
  | { ok: true; fullName: string; phone: string }
  | { ok: false; field: 'fullName' | 'phone'; message: string }

const LETTERS_ONLY = /^\p{L}+$/u

export function normalizeIsraeliMobile(raw: string): string | null {
  const digits = raw.replace(/\D/g, '')
  const local = digits.startsWith('972') ? `0${digits.slice(3)}` : digits
  return /^05\d{8}$/.test(local) ? local : null
}

export function validateCardHolder(input: { fullName: string; phone: string }): CardHolderValidation {
  const words = input.fullName
    .replace(/[-'׳"״]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (words.length < 2 || !words.every((w) => LETTERS_ONLY.test(w))) {
    return { ok: false, field: 'fullName', message: 'יש להזין שם פרטי ושם משפחה, באותיות בלבד' }
  }
  const phone = normalizeIsraeliMobile(input.phone)
  if (!phone) return { ok: false, field: 'phone', message: 'יש להזין מספר נייד ישראלי תקין, לדוגמה 0501234567' }
  return { ok: true, fullName: words.join(' '), phone }
}
