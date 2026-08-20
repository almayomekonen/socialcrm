import { db } from '@/config/db'
import { findOrCreateConversation, bumpConversationOnOutbound } from '@/db/inboxConversations'
import { ensureParticipant } from '@/db/inboxParticipants'
import { insertFailedOutboundMessage } from '@/db/inboxMessages'

/**
 * Persist an account-level outbound failure on the existing inbox tables so
 * connection health can see it immediately — without waiting for a statuses
 * webhook, and without a new column.
 *
 * Same tenant + phone scoping as a successful persist: agencyId +
 * businessPhoneNumberId. Does not enqueue AI (nothing was sent).
 */
export async function recordAccountRestriction(input: {
  agencyId: number
  leadId: number | null
  businessPhoneNumberId: string
  customerWaId: string
  customerName: string | null
  sentByUserId: number | null
  text: string
}): Promise<void> {
  await db.transaction(async (trx) => {
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

    await insertFailedOutboundMessage(trx, {
      conversationId,
      agencyId: input.agencyId,
      leadId: input.leadId,
      channel: 'whatsapp',
      externalId: null,
      fromId: input.businessPhoneNumberId,
      toId: input.customerWaId,
      text: input.text,
      sentByUserId: input.sentByUserId,
      channelTimestamp: new Date(),
      errorReason: 'account',
    })

    await bumpConversationOnOutbound(trx, conversationId, new Date(), input.text)
  })
}
