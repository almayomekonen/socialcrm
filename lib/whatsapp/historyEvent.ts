import type { ParsedWhatsappMessage } from '@/lib/adapters/whatsappMessage'

/**
 * The normalized representation of a WhatsApp Coexistence `history` webhook.
 *
 * WHY A SEPARATE SHAPE AT ALL. Meta delivers THREE different payloads under the
 * single webhook field `history`, and they are not interchangeable:
 *
 *   1. a history CHUNK — `value.history[].threads[].messages[]`
 *   2. a media FOLLOW-UP — `value.messages[]` at the top level, no threads
 *   3. an ERROR — `value.history[].errors[]`, sent when the business declined
 *      to share their history (documented code 2593109)
 *
 * A parser that assumed one shape would silently drop media, or read an error
 * as an empty archive and report a successful import of nothing. The discriminated
 * union below is what forces every consumer to handle all three.
 *
 * NOTHING HERE IS PERSISTENCE. These types describe what Meta said, normalized —
 * not what we will store. The mapping onto `inbox_messages` belongs to Wave
 * 2A.2c, and deliberately does not exist yet.
 */

/** Meta's own name for the field. Also the value of `metadata.source` on import. */
export type HistoryEventKind = 'history_chunk' | 'history_media_followup' | 'history_error'

export type HistoryDirection = 'inbound' | 'outbound'

/**
 * Why a message in an otherwise-valid chunk was not normalized.
 *
 * A skip is DATA, not an exception: one unusable message must never strand the
 * thousands around it, and it must never vanish silently either. Skips carry
 * identifiers only — never message bodies (§13).
 */
export type HistorySkipReason = 'missing_wamid' | 'invalid_timestamp' | 'malformed_message'

export type HistorySkip = {
  reason: HistorySkipReason
  /** The thread it belonged to, when the shape had one. */
  threadId: string | null
  /** The wamid, when that is not the thing that was missing. */
  externalId: string | null
}

/**
 * One historical message.
 *
 * Extends `ParsedWhatsappMessage` — the SAME adapter the live inbound path and
 * the echo path use — because a history message carries the identical envelope
 * (`id`, `timestamp`, `type`, type-keyed content). A second normalizer would
 * drift from it the first time Meta added a message type.
 *
 * `externalId` is narrowed to non-null: a message without a wamid cannot be made
 * idempotent, so it is skipped rather than represented (§7).
 */
export type ParsedHistoryMessage = Omit<ParsedWhatsappMessage, 'externalId'> & {
  externalId: string
  /** `threads[].id` — the WhatsApp user's phone number, verbatim. */
  threadId: string
  /** The same value, under the name the conversation resolver already uses. */
  customerWaId: string
  /** Derived, never read from a field — Meta documents no `direction`. */
  direction: HistoryDirection | null
  from: string
  /** Documented as present "only if the message object represents an SMB message echo". */
  to: string | null
  /**
   * Meta's literal `type` string, preserved alongside the mapped
   * `InboxMessageType`. `media_placeholder` and any future type both map to
   * `'unknown'`, and that mapping is lossy in a way persistence will care about.
   */
  rawType: string
  /** Meta sent the message WITHOUT its contents; a follow-up webhook may carry them. */
  mediaPlaceholder: boolean
  /** `history_context.status` — DELIVERED | ERROR | PENDING | PLAYED | READ | SENT. */
  historyStatus: string | null
  /** False when `rawType` is not a type the existing adapter maps. Never a reason to discard. */
  supported: boolean
}

export type ParsedHistoryThread = {
  /** `threads[].id`, verbatim — no reformatting (§6). */
  id: string
  messages: ParsedHistoryMessage[]
}

/** Fields every history event carries, whatever its shape. */
type HistoryEventBase = {
  /** The tenant key. The ONLY trusted routing input, exactly as for echoes. */
  phoneNumberId: string
  /** The business's own number. This is what `from` is compared against. */
  displayPhoneNumber: string | null
}

/**
 * Chunk identity is PRESERVED, never interpreted. Chunks are documented to
 * arrive out of order, and `chunk_order` is emphatically not an array index.
 * Assembly and replay belong to the importer (§5).
 */
export type ParsedHistoryChunk = HistoryEventBase & {
  kind: 'history_chunk'
  phase: number | null
  chunkOrder: number | null
  progress: number | null
  threads: ParsedHistoryThread[]
  skipped: HistorySkip[]
}

/**
 * The second documented shape: media contents, delivered as a SEPARATE webhook
 * with a top-level `messages[]` and no threads.
 *
 * It is kept as its own event and NOT merged into the chunk it belongs to.
 * Meta's example shows the same wamid in both webhooks, but the documentation
 * never states that correlation is guaranteed, nor which arrives first — so
 * asserting it here would be inventing a contract. Correlation is 2A.2c's
 * decision, made with the wamid this event exposes.
 */
export type ParsedHistoryMediaFollowup = HistoryEventBase & {
  kind: 'history_media_followup'
  /** No `threadId`: this shape has no threads. Direction still derives from `from`. */
  messages: Omit<ParsedHistoryMessage, 'threadId' | 'customerWaId'>[]
  skipped: HistorySkip[]
}

export type HistoryError = {
  code: number | null
  title: string | null
  message: string | null
  details: string | null
}

/**
 * The business declined to share history (documented code 2593109), or Meta
 * reported another failure.
 *
 * NEVER converted into a message or an empty success. The importer decides
 * retryability; the parser only reports what arrived.
 */
export type ParsedHistoryErrorEvent = HistoryEventBase & {
  kind: 'history_error'
  errors: HistoryError[]
  phase: number | null
  chunkOrder: number | null
  progress: number | null
}

export type ParsedHistoryEvent = ParsedHistoryChunk | ParsedHistoryMediaFollowup | ParsedHistoryErrorEvent
