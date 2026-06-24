import { db } from '@/config/db'
import { parseWhatsappMessage } from '@/lib/adapters/whatsappMessage'
import { findOrCreateConversation, bumpConversationOnInbound } from '@/db/inboxConversations'
import { ensureParticipant } from '@/db/inboxParticipants'
import { insertInboundMessage } from '@/db/inboxMessages'
import { enqueueConversationAnalysis } from '@/db/conversationIntelligence'
import { enqueueAutoResponse } from '@/db/autoResponseJobs'

export type IngestWhatsappInboundInput = {
  agencyId: number
  leadId: number
  businessPhoneNumberId: string
  customerWaId: string
  customerName: string | null
  businessName?: string | null
  rawMessage: unknown
}

export type IngestWhatsappInboundResult = {
  conversationId: number
  messageId: number
  inserted: boolean
}

export async function ingestWhatsappInbound(input: IngestWhatsappInboundInput): Promise<IngestWhatsappInboundResult> {
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

    const {
      id: messageId,
      inserted,
      sequence,
    } = await insertInboundMessage(trx, {
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

    if (inserted) {
      await bumpConversationOnInbound(trx, conversationId, parsed.channelTimestamp ?? new Date(), parsed.text)
      await enqueueConversationAnalysis(trx, {
        conversationId,
        agencyId: input.agencyId,
        channel: 'whatsapp',
        triggerSequence: sequence,
        reason: 'new_message',
      })
      // Instant Response Engine: enqueue a guarded first-contact auto-response in
      // the same txn. Internally a no-op unless the feature is enabled; the worker
      // re-checks authoritatively. Qualify-mode agencies enqueue one job per turn.
      const arMode = await trx('auto_response_settings')
        .where({ agencyId: input.agencyId, channel: 'whatsapp' })
        .first('mode')
      await enqueueAutoResponse(trx, {
        agencyId: input.agencyId,
        conversationId,
        leadId: input.leadId,
        channel: 'whatsapp',
        triggerSequence: sequence,
        reason: arMode?.mode === 'qualify' ? 'qualify_turn' : 'first_contact',
      })
    }

    return { conversationId, messageId, inserted }
  })
}
