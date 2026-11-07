import { toIsraeliWhatsappRecipient } from '@/lib/whatsapp/israeliPhone'

/**
 * The customer number an opt-out is stored and checked under: E.164 with '+'.
 *
 * It is derived with the SAME rewrite the send path applies before calling
 * Meta (`toIsraeliWhatsappRecipient`: a validated Israeli local 0XXXXXXXXX
 * becomes 972XXXXXXXXX, anything else keeps its digits). So the number checked
 * against the opt-out is exactly the number the message would go to, however
 * the caller found it: the inbound `from`, the conversation's wa_id, or a
 * lead's typed phone.
 *
 * Null when the result is not a plausible E.164 number (8–15 digits, no
 * leading 0). Callers treat null as "cannot be checked", never as "allowed".
 */
export function toCustomerPhoneE164(raw: string | null | undefined): string | null {
  const digits = toIsraeliWhatsappRecipient(String(raw ?? ''))
  return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null
}
