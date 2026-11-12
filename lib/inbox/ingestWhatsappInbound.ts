import { db } from '@/config/db'
import { parseWhatsappMessage } from '@/lib/adapters/whatsappMessage'
import { findOrCreateConversation, bumpConversationOnInbound } from '@/db/inboxConversations'
import { ensureParticipant } from '@/db/inboxParticipants'
import { insertInboundMessage } from '@/db/inboxMessages'
import { enqueueConversationAnalysis } from '@/db/conversationIntelligence'
import { enqueueInboundAutoResponse } from '@/lib/inbox/autoresponse/enqueueInboundAutoResponse'
import { isQuestionnaireConversation } from '@/db/questionnaireSessions'
import { waTrace } from '@/lib/inbox/autoresponse/waTrace'
import { notifyEvent } from '@/lib/notifications/emit'
import { recordInboundOptOut } from '@/lib/whatsapp/optOut/recordInbound'
import { invitationRefIn } from '@/lib/quotes/invitationRef'

export type IngestWhatsappInboundInput = {
  agencyId: number
  leadId: number | null
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
  /** Seconds applied to the enqueued IRE job's notBefore. 0 when no job was created. */
  autoResponseDelaySeconds: number
  ireEnqueued: boolean
  /** A live quote invitation this message answered (lib/waAssistant/quotes/invitationReply.ts); null otherwise. */
  quoteInvitationId: number | null
}

export async function ingestWhatsappInbound(input: IngestWhatsappInboundInput): Promise<IngestWhatsappInboundResult> {
  const parsed = parseWhatsappMessage(input.rawMessage)

  // "עצור" / STOP / START: recorded first, for every mode and with AI off, in
  // its own transaction (lib/whatsapp/optOut/recordInbound.ts). From here on
  // the send gate refuses every automated message to this customer.
  await recordInboundOptOut({
    agencyId: input.agencyId,
    customerWaId: input.customerWaId,
    type: parsed.type,
    text: parsed.text,
    externalId: parsed.externalId,
    channelTimestamp: parsed.channelTimestamp,
  })

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

    waTrace(
      'CONVERSATION_READY',
      { conversationId, agencyId: input.agencyId, messageId, triggerSequence: sequence },
      { existing: !inserted, messageInserted: inserted, sequence, firstInbound: sequence === 1 },
    )

    let autoResponseDelaySeconds = 0
    let ireEnqueued = false
    let quoteInvitationId: number | null = null
    if (inserted) {
      await bumpConversationOnInbound(trx, conversationId, parsed.channelTimestamp ?? new Date(), parsed.text)
      const convFlags = await trx('inbox_conversations')
        .where({ id: conversationId, agencyId: input.agencyId })
        .first('isPersonal')
      const isPersonal = convFlags?.isPersonal === true
      // A questionnaire conversation is answered deterministically and must cost
      // nothing in model calls, so it gets no Copilot analysis job either. The
      // check is scoped to this conversation; the agency's other AI is untouched.
      const questionnaire = await isQuestionnaireConversation(trx, input.agencyId, conversationId)
      // The customer pressed Send on the message an email invitation pre-filled. Matched only by the
      // reference AND this exact agency, business number and customer number; the quote reply below
      // answers it, so no AI runs on this one message:
      // neither the customer-facing autoresponder nor the Copilot analysis.
      if (invitationRefIn(parsed.text)) {
        const { matchInvitationReply } = await import('@/lib/waAssistant/quotes/invitationReply')
        quoteInvitationId = await matchInvitationReply(trx, { agencyId: input.agencyId, businessPhoneNumberId: input.businessPhoneNumberId, customerWaId: input.customerWaId, text: parsed.text })
      }
      // Copilot analysis stays Lead-only. IRE may run for non-personal Contacts.
      if (!questionnaire && quoteInvitationId == null && input.leadId != null && input.leadId > 0) {
        await enqueueConversationAnalysis(trx, {
          conversationId,
          agencyId: input.agencyId,
          channel: 'whatsapp',
          triggerSequence: sequence,
          reason: 'new_message',
        })
      }
      if (!isPersonal && quoteInvitationId == null) {
        const enqueued = await enqueueInboundAutoResponse(trx, {
          agencyId: input.agencyId,
          conversationId,
          leadId: input.leadId,
          triggerSequence: sequence,
        })
        if (enqueued.jobId != null) {
          autoResponseDelaySeconds = enqueued.delaySeconds
          ireEnqueued = true
        }
        waTrace(
          'JOB_CREATED',
          { conversationId, agencyId: input.agencyId, jobId: enqueued.jobId, messageId, triggerSequence: sequence },
          {
            jobId: enqueued.jobId,
            reason: enqueued.reason,
            triggerSequence: sequence,
            enqueued: enqueued.jobId != null,
            suppressed: enqueued.suppressed ?? null,
          },
        )
      }

      // Notification engine — same txn as the message INSERT so a rolled-back
      // ingest enqueues nothing. Emit ONLY on inserted=true: webhook retries that
      // hit (channel, externalId) return the existing row and must stay silent.
      // Identity is payload.messageId (inbox_messages.id); see eventKey.ts.
      // Awareness still owns the live toast (AWARENESS_OWNED_CATEGORIES).
      await notifyEvent(
        {
          type: 'message.inbound',
          agencyId: input.agencyId,
          entityType: 'conversation',
          entityId: conversationId,
          actorUserId: null,
          occurredAt: parsed.channelTimestamp ?? new Date(),
          payload: {
            leadId: input.leadId,
            leadName: input.customerName,
            messageId,
            provider: 'whatsapp',
          },
        },
        { trx },
      )
    }

    return { conversationId, messageId, inserted, autoResponseDelaySeconds, ireEnqueued, quoteInvitationId }
  })
}
