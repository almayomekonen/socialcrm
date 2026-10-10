import { db } from '@/config/db'
import { clearConversationAttention } from '@/db/notifications/conversationAttention'
import { findOrCreateConversation, bumpConversationOnOutbound } from '@/db/inboxConversations'
import { ensureParticipant } from '@/db/inboxParticipants'
import { ATTACHMENT_MEDIA_TYPES, insertOutboundMessage } from '@/db/inboxMessages'
import { parseMessageEchoes, echoPhoneNumberId, type ParsedMessageEcho } from '@/lib/whatsapp/parseMessageEcho'

/**
 * Persist WhatsApp Coexistence message echoes — the business's own outbound
 * traffic, sent from their WhatsApp Business app rather than through SocialCRM.
 *
 * A DEDICATED PATH THAT SHARES PRIMITIVES. It calls the same
 * `findOrCreateConversation`, `ensureParticipant`, `insertOutboundMessage` and
 * `bumpConversationOnOutbound` the composer path calls — but it deliberately
 * does NOT go through `ingestWhatsappInbound`, and does not reuse
 * `persistOutboundWhatsapp` either.
 *
 * That separation IS the safety mechanism, and it is why there are no
 * `isEcho` flags threaded through the inbound pipeline. An echo must never
 * reach `enqueueInboundAutoResponse`, `createLeadFromWhatsappWebhook`,
 * `notifyEvent('message.inbound')` or the automation emitter — and the way to
 * guarantee that is for this module never to import them, which a test asserts.
 * A shared path guarded by a boolean is one forgotten branch away from firing an
 * automated reply at a real customer about a message the business already sent.
 *
 * NO CONVERSATION ANALYSIS. `persistOutboundWhatsapp` enqueues it; this does
 * not. An echo is a message the CRM had no part in, and the conservative
 * default for anything that spends model budget is off. It is a reversible
 * choice: the next real event in the conversation enqueues analysis anyway.
 *
 * THE REAL META TIMESTAMP IS USED THROUGHOUT — for the message row and for the
 * conversation bump. `persistOutboundWhatsapp` passes `new Date()` in both
 * places, which is harmless for a message we are sending at that instant and
 * wrong for one we are being told about after the fact.
 *
 * NO LEAD IS EVER CREATED. An echo proves the business talked to someone; it
 * proves nothing about whether that someone is a Lead. A leadless Contact
 * conversation stays leadless, and promotion remains the human decision it
 * already is.
 */

export type IngestEchoResult = {
  /** Echoes parsed out of the payload. */
  parsed: number
  /** Rows genuinely inserted (duplicates excluded). */
  persisted: number
  /** Redeliveries of an echo we already hold. Expected traffic, never an error. */
  duplicates: number
  skipped: number
  errored: number
}

const EMPTY: IngestEchoResult = { parsed: 0, persisted: 0, duplicates: 0, skipped: 0, errored: 0 }

/**
 * The metadata marker. Reuses the established convention — a `source` merged
 * onto the row after insert with `metadata || ?::jsonb`, exactly as the IRE
 * writes `auto_response`.
 *
 * IT MUST NOT BE `auto_response`. `db/ai/leadFacts.ts` computes
 * `lastHumanOutboundAt` as the newest outbound whose `metadata->>'source' IS
 * DISTINCT FROM 'auto_response'`, so marking an echo that way would keep the
 * conversation looking unanswered — the precise bug this module exists to fix.
 * A person typed this message on their phone, so it counts as a human reply,
 * and `qualifyWorker` correctly reads it as a human takeover that stops the
 * agent.
 */
export const ECHO_SOURCE = 'smb_message_echo'

async function persistOne(
  agencyId: number,
  businessPhoneNumberId: string,
  echo: ParsedMessageEcho,
): Promise<'persisted' | 'duplicate'> {
  return db.transaction(async (trx) => {
    const conversationId = await findOrCreateConversation(trx, {
      agencyId,
      // NULL never clears an existing link: the upsert's merge clause updates
      // only `updatedAt` and `customerName`, so a lead-linked conversation keeps
      // its lead. On a genuinely new conversation this correctly leaves a
      // leadless Contact.
      leadId: null,
      channel: 'whatsapp',
      businessPhoneNumberId,
      customerWaId: echo.customerWaId,
      customerName: null,
    })

    // The message inherits the conversation's OWN lead, read back inside the
    // transaction rather than assumed, so a lead-linked thread produces
    // lead-linked messages and a Contact thread does not invent one.
    const conv = await trx('inbox_conversations').where({ id: conversationId }).first('leadId')
    const leadId = conv?.leadId == null ? null : Number(conv.leadId)

    await ensureParticipant(trx, {
      conversationId,
      agencyId,
      role: 'customer',
      waId: echo.customerWaId,
      displayName: null,
      leadId,
    })
    await ensureParticipant(trx, {
      conversationId,
      agencyId,
      role: 'business',
      waId: businessPhoneNumberId,
      displayName: null,
      leadId: null,
    })

    const { id: messageId, inserted } = await insertOutboundMessage(trx, {
      conversationId,
      agencyId,
      leadId,
      channel: 'whatsapp',
      externalId: echo.externalId,
      fromId: businessPhoneNumberId,
      toId: echo.customerWaId,
      text: echo.text,
      /**
       * Straight through from the parser — the SAME parser that types inbound
       * media correctly. Flattening these to text here is what made a file the
       * business sent render as "—", unrecoverably: the media id was never
       * written, so nothing was left to fetch afterwards.
       *
       * The payload is carried only for media. For a text echo the parser
       * returns `{ body }`, and persisting that would both duplicate the message
       * body into a second column and change what every existing outbound text
       * row looks like — a change this fix has no reason to make.
       *
       * A reaction keeps its `{ message_id, emoji }` too: without it the
       * owner's reaction is stored as a reaction to nothing, and the thread
       * cannot say which message it was or what the emoji was.
       */
      type: echo.type,
      payload: ATTACHMENT_MEDIA_TYPES.has(echo.type) || echo.type === 'reaction' ? echo.payload : {},
      // The message the owner quoted, for the thread's quote strip. An echo is
      // stored without a raw payload, so this is the only place it survives.
      // New rows only; nothing is backfilled.
      ...(echo.replyToExternalId ? { metadata: { replyTo: { id: echo.replyToExternalId } } } : {}),
      // NULL: no SocialCRM user sent this. The column is how the IRE tells
      // "any outbound" from "a person replied through the product", and naming
      // an arbitrary user here would be a lie about who acted.
      sentByUserId: null,
      channelTimestamp: echo.channelTimestamp,
    })

    /**
     * EVERY side effect is gated on a genuine insert.
     *
     * Meta redelivers on any non-2xx, so duplicate echoes are expected traffic.
     * `bumpConversationOnOutbound` increments `messageCount` and overwrites
     * `lastMessageAt`, so running it for a redelivery would inflate the count
     * and drag the conversation's ordering forward — which is exactly the bug
     * `persistOutboundWhatsapp` still carries by bumping unconditionally.
     */
    if (!inserted) return 'duplicate'

    // The REAL Meta timestamp, never the clock. `bumpConversationOnOutbound`
    // already accepts it, so no helper needed changing.
    await bumpConversationOnOutbound(trx, conversationId, echo.channelTimestamp ?? new Date(), echo.text)

    await trx('inbox_messages')
      .where({ id: messageId })
      .update({
        metadata: db.raw(`metadata || ?::jsonb`, [JSON.stringify({ source: ECHO_SOURCE })]),
      })

    // The owner answered from the WhatsApp Business app: that is a human reply,
    // so "waiting for a person" notifications about this chat are resolved.
    await clearConversationAttention(trx, { agencyId, conversationId })

    return 'persisted'
  })
}

/**
 * Ingest every echo in one `smb_message_echoes` webhook delivery.
 *
 * TENANCY. The agency is resolved from `metadata.phone_number_id` against
 * `whatsapp_connections` — the same mapping inbound uses, and the only tenant
 * input trusted anywhere in this path. The customer's phone number is never a
 * tenant key: it is attacker-influenced payload data, and two agencies can
 * legitimately talk to the same person.
 *
 * NEVER THROWS. The webhook must answer 200 or Meta retries and can disable the
 * subscription. One bad echo never strands its siblings.
 */
export async function ingestWhatsappEchoes(value: unknown): Promise<IngestEchoResult> {
  const phoneNumberId = echoPhoneNumberId(value)
  if (!phoneNumberId) {
    console.warn('[WhatsappEcho] no phone_number_id on the payload — ignoring')
    return { ...EMPTY }
  }

  const echoes = parseMessageEchoes(value)
  if (echoes.length === 0) return { ...EMPTY }

  const result: IngestEchoResult = { ...EMPTY, parsed: echoes.length }

  const connection = await db('whatsapp_connections')
    .where({ phone_number_id: phoneNumberId })
    .first('agency_id')
    .catch(() => null)
  if (!connection) {
    console.warn('[WhatsappEcho] no connection for phone_number_id — ignoring', { phoneNumberId })
    return { ...result, skipped: echoes.length }
  }
  const agencyId = Number(connection.agency_id)

  for (const echo of echoes) {
    try {
      const outcome = await persistOne(agencyId, phoneNumberId, echo)
      if (outcome === 'persisted') result.persisted += 1
      else result.duplicates += 1
    } catch (err) {
      result.errored += 1
      console.error('[WhatsappEcho] persist failed', { phoneNumberId, err: String(err) })
    }
  }

  console.log('[WhatsappEcho] delivery processed', { phoneNumberId, agencyId, ...result })
  return result
}
