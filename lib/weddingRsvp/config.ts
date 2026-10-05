import { toIsraeliWhatsappRecipient } from '@/lib/whatsapp/israeliPhone'

/**
 * TEMPORARY — Wedding RSVP (פסיקה ואלמיהו, 18.11.26). Delete after the event.
 *
 * Everything wedding-specific lives in `lib/weddingRsvp/`. Removal checklist:
 *   1. delete `lib/weddingRsvp/` and `app/api/wedding-rsvp/`
 *   2. delete `__tests__/weddingRsvp/`
 *   3. remove the one `routeWeddingRsvpReply` hook in `lib/whatsapp/handleInboundWebhookMessage.ts`
 * No schema, no flags, no env vars. Replies live in inbox_messages like any other message.
 */

export const WEDDING_RSVP_ATTENDING = 'wedding_rsvp_attending'
export const WEDDING_RSVP_NOT_ATTENDING = 'wedding_rsvp_not_attending'

export const RSVP_BODY = 'היי ❤️\nנשמח לאישור הגעה לחתונה של פסיקה ואלמיהו ב־18.11.26 💍'
export const RSVP_BUTTONS = [
  { id: WEDDING_RSVP_ATTENDING, title: 'מגיע/ה' },
  { id: WEDDING_RSVP_NOT_ATTENDING, title: 'לא מגיע/ה' },
] as const

/** The Cloud API `interactive` object for the RSVP (reply buttons; titles ≤ 20 chars). */
export const RSVP_INTERACTIVE = {
  type: 'button',
  body: { text: RSVP_BODY },
  action: { buttons: RSVP_BUTTONS.map((b) => ({ type: 'reply', reply: { id: b.id, title: b.title } })) },
}

export const REPLY_ATTENDING = 'מעולה ❤️ כמה אנשים תגיעו בסך הכול?'
export const REPLY_NOT_ATTENDING = 'תודה שעדכנת ❤️'

/** `metadata.source` on the automatic follow-ups, so they never read as a human reply. */
export const WEDDING_RSVP_SOURCE = 'wedding_rsvp'

/**
 * Hard recipient allowlist. Test phase: Keren only. Both the send and the
 * automatic follow-up replies refuse any wa_id not listed here.
 */
export const ALLOWED_WA_IDS: ReadonlySet<string> = new Set(['972535316943'])

export function isAllowedRecipient(waId: string | null | undefined): boolean {
  if (!waId) return false
  return ALLOWED_WA_IDS.has(toIsraeliWhatsappRecipient(waId))
}
