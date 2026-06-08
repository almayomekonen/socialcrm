import { db } from '@/config/db'
import { findOrCreateConversation, bumpConversationOnOutbound } from '@/db/inboxConversations'
import { ensureParticipant } from '@/db/inboxParticipants'
import { insertOutboundMessage } from '@/db/inboxMessages'

/**
 * Persist a successfully-sent outbound WhatsApp message into the SAME conversation
 * model used for inbound (thread + participants + message + aggregate bump), in one
 * transaction. Mirrors ingestWhatsappInbound. Called ONLY after the Cloud API send
 * returns a wamid, so failed sends never create a conversation entry.
 */

export type PersistOutboundWhatsappInput = {
  agencyId: number
  leadId: number
  businessPhoneNumberId: string
  customerWaId: string
  customerName: string | null
  sentByUserId: number
  wamid: string
  text: string
}

export type PersistOutboundWhatsappResult = {
  conversationId: number
  messageId: number
}

export async function persistOutboundWhatsapp(
  input: PersistOutboundWhatsappInput,
): Promise<PersistOutboundWhatsappResult> {
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
      displayName: null,
      leadId: null,
    })

    const { id: messageId } = await insertOutboundMessage(trx, {
      conversationId,
      agencyId: input.agencyId,
      leadId: input.leadId,
      channel: 'whatsapp',
      externalId: input.wamid,
      fromId: input.businessPhoneNumberId,
      toId: input.customerWaId,
      text: input.text,
      sentByUserId: input.sentByUserId,
      channelTimestamp: new Date(),
    })

    await bumpConversationOnOutbound(trx, conversationId, new Date())

    return { conversationId, messageId }
  })
}
