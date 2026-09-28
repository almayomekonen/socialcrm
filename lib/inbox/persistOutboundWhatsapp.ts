import { db } from '@/config/db'
import { findOrCreateConversation, bumpConversationOnOutbound } from '@/db/inboxConversations'
import { ensureParticipant } from '@/db/inboxParticipants'
import { insertOutboundMessage } from '@/db/inboxMessages'
import { enqueueConversationAnalysis } from '@/db/conversationIntelligence'
import { isQuestionnaireConversation } from '@/db/questionnaireSessions'
import { clearConversationAttention } from '@/db/notifications/conversationAttention'
import { isHumanOutbound } from '@/lib/inbox/humanReply'

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
  /**
   * Written INSIDE the insert, not merged afterwards.
   *
   * `metadata.source` is what tells the rest of the system an automation sent
   * this message rather than a person. Every existing caller sets it with a
   * second UPDATE after this function returns, which leaves a window: a process
   * that dies in between leaves an untagged row, and an untagged outbound reads
   * as a human takeover — silencing the automation on that conversation for
   * good. Passing it here closes that window. Optional, so callers that do not
   * pass it behave exactly as before.
   */
  metadata?: Record<string, unknown>
  /**
   * Skip the Copilot analysis job for this message.
   *
   * Analysis is an LLM call. A questionnaire conversation must not incur one,
   * and the guarantee has to hold at the point the job would be created.
   */
  skipAnalysis?: boolean
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
      metadata: input.metadata,
    })

    await bumpConversationOnOutbound(trx, conversationId, new Date(), input.text)

    // A person answered: "waiting for a person" notifications about this chat
    // are no longer true. AI, questionnaire and automation sends are not people.
    const source = typeof input.metadata?.source === 'string' ? input.metadata.source : null
    if (inserted && isHumanOutbound({ source, sentByUserId: input.sentByUserId })) {
      await clearConversationAttention(trx, { agencyId: input.agencyId, conversationId })
    }

    // Same rule as the inbound path: a questionnaire conversation never buys a
    // model call. Checked here as well as at the caller so a rep's own reply in
    // such a thread does not quietly re-introduce one.
    const analysisAllowed =
      input.skipAnalysis !== true && !(await isQuestionnaireConversation(trx, input.agencyId, conversationId))
    if (inserted && analysisAllowed) {
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
