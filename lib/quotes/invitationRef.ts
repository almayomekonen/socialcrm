import { createHash, randomBytes } from 'node:crypto'

/**
 * The opaque reference a customer sends back on WhatsApp after an email
 * invitation (lib/waAssistant/quotes/emailInvite.ts). Pure.
 *
 * 16 Crockford base-32 characters: 80 random bits, no CRM identifier, no
 * amount, nothing about the quote. It is stored only as a SHA-256, and it is
 * accepted only from the exact customer number and business number it was bound
 * to, so a guessed or forwarded reference opens nothing.
 */

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
export const INVITATION_REF_LENGTH = 16
const MARKER = 'SCQ-'
const REF_IN_TEXT = new RegExp(`${MARKER}([${ALPHABET}]{${INVITATION_REF_LENGTH}})`, 'i')

export function newInvitationRef(): string {
  const bytes = randomBytes(INVITATION_REF_LENGTH)
  let out = ''
  // 256 is a multiple of 32: each byte maps uniformly onto the alphabet.
  for (const b of bytes) out += ALPHABET[b % 32]
  return out
}

export const hashInvitationRef = (ref: string) => createHash('sha256').update(ref.toUpperCase()).digest('hex')

/** The reference inside a customer's message, or null. Case-insensitive; the customer may have typed around it. */
export function invitationRefIn(text: string | null | undefined): string | null {
  const m = typeof text === 'string' ? REF_IN_TEXT.exec(text) : null
  return m ? m[1].toUpperCase() : null
}

/** What WhatsApp pre-fills. The customer still has to press Send. */
export const invitationPrefill = (ref: string) => `שלום, אשמח לקבל את הצעת המחיר. (קוד: ${MARKER}${ref})`

/** wa.me wants the number in international form, digits only. */
export function whatsappClickToChat(businessDisplayNumber: string, text: string): string | null {
  const digits = businessDisplayNumber.replace(/\D/g, '')
  if (digits.length < 8 || digits.length > 15) return null
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`
}
