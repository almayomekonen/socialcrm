import { normalizePhone } from '@/lib/leads/normalizeContact'

/**
 * `wa.me` deep links — the Phase A WhatsApp action.
 *
 * WHY NOT THE INBOX. Desktop routes WhatsApp through the in-app inbox
 * (`openLeadWhatsappInInbox`). The mobile inbox is Phase C, so routing there in
 * Phase A would drop a rep into a desktop three-pane surface on a phone — the
 * "responsive desktop" outcome this program exists to avoid. A `wa.me` link
 * opens the app the rep already uses, in one tap, with no new surface.
 *
 * PHASE C REPLACES THIS ENTRY POINT with the in-app conversation experience;
 * the thread, history and templates all live there. Nothing here writes a
 * message, creates a conversation, or touches the WhatsApp backend — it is a
 * link, and that is the whole of it.
 *
 * NO BACKEND ACTION IS CREATED. No `sendWhatsappReply`, no conversation row, no
 * webhook interaction. Authorization is unaffected: the phone number came from a
 * lead the viewer was already permitted to read.
 *
 * PURE: no I/O, no framework. Unit-testable.
 */

/** wa.me requires digits only — no `+`, spaces, hyphens or parentheses. */
export function waPhoneDigits(raw: string | null | undefined): string | null {
  // normalizePhone already yields `972XXXXXXXXX` (digits only, country-prefixed)
  // and returns null below 9 digits. Reusing it keeps the mobile link agreeing
  // with how the webhooks and the importer normalise the same numbers.
  return normalizePhone(raw)
}

/**
 * A wa.me URL, or null when there is no usable number.
 *
 * Callers MUST treat null as "render no WhatsApp action" — never a disabled or
 * dead button. A tappable control that cannot work is worse than its absence.
 *
 * `text` is optional and is NOT defaulted: there is no product-defined outbound
 * message for this action, and inventing a sales opener would put words in the
 * rep's mouth and in the customer's inbox. When a caller does pass one it is
 * `encodeURIComponent`-escaped.
 */
export function waMeHref(phone: string | null | undefined, text?: string | null): string | null {
  const digits = waPhoneDigits(phone)
  if (!digits) return null
  const base = `https://wa.me/${digits}`
  const body = text?.trim()
  return body ? `${base}?text=${encodeURIComponent(body)}` : base
}
