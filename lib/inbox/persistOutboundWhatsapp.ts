import { db } from '@/config/db'
import { findOrCreateConversation, bumpConversationOnOutbound } from '@/db/inboxConversations'
import { ensureParticipant } from '@/db/inboxParticipants'
import { insertOutboundMessage } from '@/db/inboxMessages'
import { enqueueConversationAnalysis } from '@/db/conversationIntelligence'

export type PersistOutboundWhatsappInput = {
  agencyId: number
  leadId: number | null
  businessPhoneNumberId: string
  customerWaId: string
  customerName: string | null
  /** The sending user, or null when an automation sent it (see InsertOutboundMessageInput). */
  sentByUserId: number | null
  wamid: string
  text: string
}

export type PersistOutboundWhatsappResult = {
  conversationId: number
  messageId: number
  sequence: number
}

export async function persistOutboundWhatsapp(input: PersistOutboundWhatsappInput): Promise<PersistOutboundWhatsappResult> {
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

    const {
      id: messageId,
      inserted,
      sequence,
    } = await insertOutboundMessage(trx, {
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

    await bumpConversationOnOutbound(trx, conversationId, new Date(), input.text)

    if (inserted) {
      await enqueueConversationAnalysis(trx, {
        conversationId,
        agencyId: input.agencyId,
        channel: 'whatsapp',
        triggerSequence: sequence,
        reason: 'new_message',
      })
    }

    return { conversationId, messageId, sequence }
  })
}
