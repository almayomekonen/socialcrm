import { db } from '@/config/db'
import { ensureHistoryConversation, getConversationMemory } from '@/db/inboxConversations'
import { insertHistoryMessage } from '@/db/inboxMessages'
import { HISTORY_SOURCE, historySourceMerge } from '@/lib/inbox/messageTimeline'
import type { ParsedHistoryMessage } from '@/lib/whatsapp/historyEvent'

/**
 * Persist ONE message from a WhatsApp Coexistence history archive.
 *
 * HISTORY IS PASSIVE ARCHIVAL DATA. That sentence is the entire design. A
 * historical message is something that already happened and was already handled;
 * it is not an event. So this module inserts a row and does nothing else — it
 * does not bump the conversation, touch unread, create a lead, enqueue an
 * auto-response, emit a signal, notify anyone, or spend a model token.
 *
 * A DEDICATED PATH THAT SHARES PRIMITIVES, exactly as `ingestWhatsappEcho`
 * established. It calls the same `getConversationMemory` and the same
 * `insertChannelMessage` (via `insertHistoryMessage`) the live paths call, but
 * it never goes through `ingestWhatsappInbound` and never imports a side effect.
 * That separation IS the safety mechanism, and it is why there is no `isHistory`
 * flag threaded through the inbound pipeline: a shared path guarded by a boolean
 * is one forgotten branch away from firing an automated reply at a customer
 * about a message from four months ago. A test asserts the forbidden imports
 * are absent.
 *
 * IT CREATES A CONVERSATION BUT NEVER A LEAD (Wave 2A.2g.1, F-3). When no
 * conversation exists for `(agency, business number, customer)`, one is created
 * — leadless, and neutral in every current-state column — via
 * `ensureHistoryConversation`. `findOrCreateConversation` is deliberately still
 * NOT used: its upsert writes `updatedAt`/`customerName` onto an existing row,
 * and a history import must be provably incapable of touching a live
 * conversation at all.
 *
 * The Lead boundary is unchanged. An archive proves the business talked to
 * someone; it proves nothing about whether that someone is a Lead. Promotion
 * remains the human decision it already is.
 *
 * NOT REACHABLE FROM PRODUCTION. Nothing calls this yet, the webhook is
 * unwired, and `HISTORY_SYNC_ENABLED` is still false.
 */

export type HistoryPersistContext = {
  /** Resolved from `phoneNumberId` via `resolveHistoryTenant` — never from the payload. */
  agencyId: number
  /** The business number id Meta sent. Half of the conversation key. */
  phoneNumberId: string
  /** Chunk identity, preserved on the row for provenance. Never interpreted here. */
  phase: number | null
  chunkOrder: number | null
  progress: number | null
}

export type PersistHistoryResult =
  | { outcome: 'inserted'; messageId: number; conversationId: number; leadId: number | null }
  /** A redelivery of a message we already hold. Expected traffic, never an error. */
  | { outcome: 'duplicate'; messageId: number; conversationId: number }
  /**
   * Retained for the caller's exhaustiveness, but no longer produced: since
   * F-3 a missing conversation is created rather than refused. Kept so the
   * worker's handling of it stays compiled and a future policy that reintroduces
   * refusal has somewhere to land.
   */
  | { outcome: 'no_conversation' }
  | { outcome: 'skipped'; reason: 'unknown_direction' }

/**
 * `phone_number_id` → agency, the same mapping every other WhatsApp ingestion
 * path uses.
 *
 * THE ONLY TENANT INPUT EVER TRUSTED. The customer's number is never a tenant
 * key: it is attacker-influenced payload data, and two agencies can legitimately
 * hold conversations with the same person.
 *
 * VALIDITY IS ROW EXISTENCE, matching `ingestWhatsappEcho`,
 * `ingestWhatsappStatuses` and the IRE. `whatsapp_connections` carries no
 * status column, and filtering on the Wave 0 `health_status` would diverge from
 * every sibling path and silently discard an irreplaceable one-time archive
 * because a token probe happened to be failing.
 *
 * Exported separately so a future batch layer resolves the tenant ONCE per
 * delivery rather than once per message.
 *
 * IT THROWS ON A DATABASE FAILURE, and returns null ONLY when the lookup
 * genuinely found no connection (Wave 2A.2g.1, F-2). Those two are opposite
 * facts and were previously indistinguishable: a `.catch(() => null)` turned a
 * transient outage into "this number is not ours", the webhook acknowledged with
 * 200, and Meta — which redelivers only on a non-2xx — never sent that piece of
 * the one-shot archive again. Silence about an infrastructure failure is the one
 * thing this feature cannot afford.
 */
export async function resolveHistoryTenant(phoneNumberId: string): Promise<number | null> {
  const connection = await db('whatsapp_connections').where({ phone_number_id: phoneNumberId }).first('agency_id')
  return connection ? Number(connection.agency_id) : null
}

export async function persistHistoryMessage(
  message: ParsedHistoryMessage,
  ctx: HistoryPersistContext,
): Promise<PersistHistoryResult> {
  // Direction is derived, not read, and the parser returns null when Meta's
  // payload gave it no documented basis. `direction` is NOT NULL on the row, and
  // guessing would put the business's own message in the customer's half of the
  // thread — so it is refused rather than defaulted.
  if (message.direction === null) return { outcome: 'skipped', reason: 'unknown_direction' }

  // Fast path: scoped by agency AND business number AND customer, so a
  // mismatched tenant pair resolves to nothing rather than another agency's
  // thread. This is the tenant boundary, enforced by the lookup itself.
  const existing = await getConversationMemory(ctx.agencyId, ctx.phoneNumberId, message.customerWaId)

  return db.transaction(async (trx) => {
    /**
     * THE ARCHIVE MAY ESTABLISH THE CONVERSATION (Wave 2A.2g.1, F-3).
     *
     * Requiring a pre-existing conversation made the feature import almost
     * nothing in the only situation that matters: at coexistence onboarding the
     * CRM holds no conversations for that business yet, and Meta delivers the
     * archive within 24 hours. Every thread resolved to `no_conversation`,
     * settled `partial`, and was never revisited — a one-shot archive quietly
     * discarded while every test passed.
     *
     * It creates a CONVERSATION and never a LEAD. The row is born neutral (all
     * current-state columns default to NULL/0) and no bump helper runs, so the
     * conversation exists to hold history without claiming anything about now.
     *
     * Created inside the message's own transaction: if the insert below fails,
     * the conversation is not left behind either.
     */
    const conversation =
      existing ??
      (await ensureHistoryConversation(trx, {
        agencyId: ctx.agencyId,
        businessPhoneNumberId: ctx.phoneNumberId,
        customerWaId: message.customerWaId,
      }))

    const { id: messageId, inserted } = await insertHistoryMessage(trx, {
      conversationId: conversation.id,
      agencyId: ctx.agencyId,
      // The conversation's OWN lead, whatever it already is. A lead-linked
      // thread yields lead-linked messages; a leadless Contact thread stays
      // leadless. No lead is created, inferred, or promoted.
      leadId: conversation.leadId,
      direction: message.direction as 'inbound' | 'outbound',
      channel: 'whatsapp',
      // The wamid. The existing `(channel, externalId)` unique constraint is the
      // ONLY deduplication mechanism; there is no second one.
      externalId: message.externalId,
      fromId: message.from || null,
      toId: message.to,
      // `media_placeholder` and any type we do not map arrive as 'unknown' with
      // their content preserved in `payload` — a truthful record that something
      // happened, with no fabricated text and no media fetched.
      type: message.type,
      text: message.text,
      payload: message.payload,
      // Deliberately null. The raw Meta object is bulk personal message content
      // and nothing reads it back for history.
      rawPayload: null,
      // Meta's own moment. `createdAt` keeps its default and stays our ingestion
      // time: the two are semantically distinct and both are needed — chronology
      // reads `channelTimestamp`, provenance reads `createdAt`.
      channelTimestamp: message.channelTimestamp,
    })

    /**
     * EVERY write past the insert is gated on a genuine insert.
     *
     * A duplicate must be a pure no-op. Meta redelivers on any non-2xx, and a
     * wamid we already hold may well belong to a LIVE message — the same
     * conversation can appear in both the archive and the live stream. Merging
     * the history marker onto that row would relabel a live message as
     * historical, removing it from the live delta and from every current-state
     * fact. First writer wins; the second says so and touches nothing.
     */
    if (!inserted) return { outcome: 'duplicate' as const, messageId, conversationId: conversation.id }

    // ONE merge, through the canonical helper. `metadata || ?::jsonb` MERGES
    // rather than replaces — the established convention — so whatever else the
    // insert put on the row survives.
    //
    // Chunk identity is RECORDED, never acted on: assembly and replay belong to
    // the job layer, and a row that cannot say which chunk it came from is a row
    // nobody can audit after an interrupted import.
    const merge = historySourceMerge({
      history: {
        phase: ctx.phase,
        chunkOrder: ctx.chunkOrder,
        progress: ctx.progress,
        status: message.historyStatus,
        rawType: message.rawType,
        mediaPlaceholder: message.mediaPlaceholder,
      },
    })
    await trx('inbox_messages')
      .where({ id: messageId })
      .update({ metadata: trx.raw(merge.sql, merge.bindings) })

    return {
      outcome: 'inserted' as const,
      messageId,
      conversationId: conversation.id,
      leadId: conversation.leadId,
    }
  })
}

/** Re-exported so callers never re-derive the marker literal. */
export { HISTORY_SOURCE }
