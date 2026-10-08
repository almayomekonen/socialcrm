import { toIsraeliWhatsappRecipient } from '@/lib/whatsapp/israeliPhone'

/**
 * TEMPORARY — Wedding RSVP (פסיקה ואלמיהו, 18.11.26). Delete after the event.
 *
 * Everything wedding-specific lives in `lib/weddingRsvp/`. Removal checklist:
 *   1. delete `lib/weddingRsvp/` and `app/api/wedding-rsvp/`
 *   2. delete `__tests__/weddingRsvp/`
 *   3. remove the one `routeWeddingRsvpReply` hook in `lib/whatsapp/handleInboundWebhookMessage.ts`
 *   4. delete `public/wedding/` (the invitation card)
 * The image-header support in `lib/whatsapp/sendTemplateMessage.ts` is generic and stays.
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
export const REPLY_THANKS = 'תודה רבה ❤️ נתראה בחתונה!'

/** What the conversation shows for the RSVP outbound: the body plus the two choices. */
export const RSVP_STORED_TEXT = `${RSVP_BODY}\n\n${RSVP_BUTTONS.map((b) => `[${b.title}]`).join(' ')}`

/** `metadata.source` on the automatic follow-ups, so they never read as a human reply. */
export const WEDDING_RSVP_SOURCE = 'wedding_rsvp'

/** A head-count answer only counts within this long of the question being asked. */
export const HEAD_COUNT_ANSWER_WINDOW_HOURS = 24
export const HEAD_COUNT_MAX = 30

/** Second key of pg_advisory_xact_lock(conversationId, namespace); quota uses 12345. */
export const WEDDING_RSVP_LOCK_NAMESPACE = 20261118

/**
 * The approved Meta template `wedding_invite` (Hebrew, MARKETING): an IMAGE header
 * (the invitation card) and a static body — no body variables. A template, so it
 * delivers to a guest with no open 24-hour window.
 */
export const INVITE_TEMPLATE_NAME = 'wedding_invite'
export const INVITE_TEMPLATE_LANGUAGE = 'he'

/**
 * The invitation card, served as a static file of this app. Meta fetches the
 * header image from this URL on every send, so it must be public, HTTPS and
 * permanent: a file in `public/` on the production domain is all three, and it
 * cannot expire the way a Cloud API media id (30 days) or a Meta CDN link would.
 * The random suffix keeps it from being guessed; it is not a secret.
 */
export const INVITE_IMAGE_PATH = '/wedding/invite-b80c5796602c.jpg'
export const INVITE_IMAGE_URL = `https://getsocialcrm.com${INVITE_IMAGE_PATH}`

export const INVITE_BODY =
  'שמחים ונרגשים להזמינכם לחגוג איתנו את היום המאושר בחיינו – החתונה שלנו! 💍\n' +
  'נשמח מאוד לראותכם לצידנו 🤗❤️💕\n\nבאהבה גדולה,\nפסיקה ואלמיהו'

/** What the conversation shows for the invite: the card marker plus the template body. */
export const INVITE_STORED_TEXT = `[תמונת ההזמנה]\n${INVITE_BODY}`

/** metadata.kind on the stored invite. Not `source`: a rep's send stays a human reply. */
export const INVITE_KIND = 'wedding_invite'

/** Second key of pg_advisory_xact_lock(hashtext(waId), namespace) for invites. */
export const WEDDING_INVITE_LOCK_NAMESPACE = 20261119

/**
 * The only agency the wedding module serves (the couple's own workspace). The
 * invite endpoint refuses every other agency, so no other tenant can send this
 * template or create leads through it.
 */
export const WEDDING_AGENCY_ID = 103

export function isWeddingAgency(agencyId: number | null | undefined): boolean {
  return agencyId === WEDDING_AGENCY_ID
}

/**
 * Hard recipient allowlist for the RSVP path ONLY: the interactive RSVP send and
 * its automatic follow-up replies refuse any wa_id not listed here. The template
 * INVITE is not allowlisted — it goes to any valid Israeli mobile, gated by the
 * session, product access and WEDDING_AGENCY_ID instead.
 *   972535316943 — Keren (RSVP test)
 *   972535353219 — Avraham Bogale (first template invite)
 *   972537736636 — Psika (first controlled RSVP test, 2026-10-08)
 */
export const ALLOWED_WA_IDS: ReadonlySet<string> = new Set(['972535316943', '972535353219', '972537736636'])

export function isAllowedRecipient(waId: string | null | undefined): boolean {
  if (!waId) return false
  return ALLOWED_WA_IDS.has(toIsraeliWhatsappRecipient(waId))
}
