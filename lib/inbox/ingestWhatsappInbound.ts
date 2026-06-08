import { db } from '@/config/db'
import { parseWhatsappMessage } from '@/lib/adapters/whatsappMessage'
import { findOrCreateConversation, bumpConversationOnInbound } from '@/db/inboxConversations'
import { ensureParticipant } from '@/db/inboxParticipants'
import { insertInboundMessage } from '@/db/inboxMessages'

/**
 * Orchestrates inbound WhatsApp persistence: thread + participants + message,
 * atomically, after the lead has already been resolved by the webhook.
 *
 * This layer is ADDITIVE — it runs after createLeadFromWhatsappWebhook and the
 * webhook wraps it so a failure here never affects the lead flow or the 200.
 * Dedup is by wamid: a retried delivery stores nothing new and does not bump
 * thread counters.
 */

export type IngestWhatsappInboundInput = {
  agencyId: number
  leadId: number
  businessPhoneNumberId: string
  customerWaId: string
  customerName: string | null
  /** Verified WhatsApp business display name, if available. */
  businessName?: string | null
  /** The raw WhatsApp message object (entry[].changes[].value.messages[0]). */
  rawMessage: unknown
}

export type IngestWhatsappInboundResult = {
  conversationId: number
  messageId: number
  inserted: boolean
}

export async function ingestWhatsappInbound(
  input: IngestWhatsappInboundInput,
): Promise<IngestWhatsappInboundResult> {
  const parsed = parseWhatsappMessage(input.rawMessage)

  return db.transaction(async (trx) => {
    const conversationId = await findOrCreateConversation(trx, {
      agencyId: input.agencyId,
      leadId: input.leadId,
      channel: 'whatsapp',
      businessPhoneNumberId: input.businessPhoneNumberId,
      customerWaId: input.customerWaId,
      customerName: input.customerName,
    })

    await ensureParticipant(trx, {
      conversationId,
      agencyId: input.agencyId,
      role: 'customer',
      waId: input.customerWaId,
      displayName: input.customerName,
      leadId: input.leadId,
    })
    await ensureParticipant(trx, {
      conversationId,
      agencyId: input.agencyId,
      role: 'business',
      waId: input.businessPhoneNumberId,
      displayName: input.businessName ?? null,
      leadId: null,
    })

    const { id: messageId, inserted } = await insertInboundMessage(trx, {
      conversationId,
      agencyId: input.agencyId,
      leadId: input.leadId,
      channel: 'whatsapp',
      externalId: parsed.externalId,
      fromId: input.customerWaId,
      toId: input.businessPhoneNumberId,
      type: parsed.type,
      text: parsed.text,
      payload: parsed.payload,
      rawPayload: input.rawMessage,
      channelTimestamp: parsed.channelTimestamp,
    })

    // Only advance thread aggregates for genuinely new messages.
    if (inserted) {
      await bumpConversationOnInbound(trx, conversationId, parsed.channelTimestamp ?? new Date())
    }

    return { conversationId, messageId, inserted }
  })
}
