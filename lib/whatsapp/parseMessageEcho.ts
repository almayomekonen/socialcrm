import { parseWhatsappMessage, type ParsedWhatsappMessage } from '@/lib/adapters/whatsappMessage'

/**
 * WhatsApp Coexistence `smb_message_echoes` → a normalized OUTBOUND message.
 *
 * WHAT AN ECHO IS. During Coexistence the business keeps using the WhatsApp
 * Business app on their phone. When they answer a customer there, Meta sends us
 * an echo of that message. It is the business's own outbound traffic, observed
 * rather than sent by us.
 *
 * WHY DISCARDING IT WAS A LIVE BUG, not just a missing feature. Without echoes
 * the CRM sees only the customer's half of a coexistence conversation, so
 * `lastHumanOutboundAt` stays null and `isWaitingForReply` reports "the customer
 * is waiting" for threads the business already answered from their phone. That
 * corrupts the Today brief's highest-priority state and the
 * `conversation.unanswered` signal for every coexistence customer, every day.
 *
 * PURE and TOTAL. It runs inside a webhook that must always answer 200, so every
 * unusable input yields `null` and nothing throws.
 *
 * IT REUSES `parseWhatsappMessage`. An echo carries the same message envelope as
 * an inbound one — `id`, `timestamp`, `type`, and the type-keyed content object
 * — so normalization is the existing adapter's job. A second parser would drift
 * from it the first time Meta added a message type.
 *
 * DIRECTION IS THE WHOLE POINT. `from` is the BUSINESS and `to` is the CUSTOMER,
 * the mirror of an inbound message. Reading `from` as the customer would create
 * a lead out of the business's own number and could aim an automated reply at
 * it — the failure mode the coexistence routing was built to prevent.
 */

export type ParsedMessageEcho = ParsedWhatsappMessage & {
  /** The customer's WhatsApp id — `to`, because the business sent this. */
  customerWaId: string
  /** The business's own number as Meta reported it. Provenance only. */
  businessWaId: string | null
  /**
   * The message this echo replies to (`context.id`), when the owner quoted one
   * in the WhatsApp Business app. Carried exactly as Meta sent it: never
   * decoded or normalized. A context without an `id` (a forwarded marker) is
   * not a reply.
   */
  replyToExternalId: string | null
}

/** A non-empty string, or null. */
function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

/**
 * Parse one echo. Returns null when the echo cannot be attributed to a
 * customer or identified — either makes it unusable, and a guessed recipient
 * would attach a message to the wrong conversation.
 */
export function parseMessageEcho(raw: unknown): ParsedMessageEcho | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const echo = raw as Record<string, unknown>

  // The recipient IS the customer. Without it there is no conversation to
  // resolve, and resolving by anything else would be a guess.
  const customerWaId = str(echo.to)
  if (!customerWaId) return null

  const parsed = parseWhatsappMessage(raw)
  // The wamid is the deduplication key. An echo without one cannot be made
  // idempotent, and Meta redelivers on any non-2xx, so it must be refused
  // rather than inserted and duplicated on the next delivery.
  if (!parsed.externalId) return null

  const context = echo.context
  const replyToExternalId =
    typeof context === 'object' && context !== null && !Array.isArray(context) ? str((context as Record<string, unknown>).id) : null

  return { ...parsed, customerWaId, businessWaId: str(echo.from), replyToExternalId }
}

/**
 * Every usable echo in one webhook `value`, in payload order.
 *
 * Meta batches echoes under `message_echoes` (not `messages` — which is what
 * kept them out of the inbound reader even before the explicit routing guard).
 * A malformed entry is skipped, never allowed to strand its siblings.
 */
export function parseMessageEchoes(value: unknown): ParsedMessageEcho[] {
  if (typeof value !== 'object' || value === null) return []
  const echoes = (value as { message_echoes?: unknown }).message_echoes
  if (!Array.isArray(echoes)) return []

  const out: ParsedMessageEcho[] = []
  for (const raw of echoes) {
    const parsed = parseMessageEcho(raw)
    if (parsed) out.push(parsed)
  }
  return out
}

/** The business phone the echo was sent from — the tenant key, from `metadata`. */
export function echoPhoneNumberId(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null
  const metadata = (value as { metadata?: unknown }).metadata
  if (typeof metadata !== 'object' || metadata === null) return null
  return str((metadata as Record<string, unknown>).phone_number_id)
}
