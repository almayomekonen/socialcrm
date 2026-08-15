import { db } from '@/config/db'
import { parseWhatsappMessage } from '@/lib/adapters/whatsappMessage'
import { findOrCreateConversation, bumpConversationOnInbound } from '@/db/inboxConversations'
import { ensureParticipant } from '@/db/inboxParticipants'
import { insertInboundMessage } from '@/db/inboxMessages'
import { enqueueConversationAnalysis } from '@/db/conversationIntelligence'
import { enqueueAutoResponse } from '@/db/autoResponseJobs'
import { waTrace } from '@/lib/inbox/autoresponse/waTrace'
import { notifyEvent } from '@/lib/notifications/emit'

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

    waTrace(
      'CONVERSATION_READY',
      { conversationId, agencyId: input.agencyId, messageId, triggerSequence: sequence },
      { existing: !inserted, messageInserted: inserted, sequence, firstInbound: sequence === 1 },
    )

    if (inserted) {
      await bumpConversationOnInbound(trx, conversationId, parsed.channelTimestamp ?? new Date(), parsed.text)
      // Leadless / personal conversations are never sales conversations:
      // no Copilot analysis, no auto-response, no SLA/follow-up jobs.
      if (input.leadId != null && input.leadId > 0) {
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
        const arSettings = await trx('auto_response_settings')
          .where({ agencyId: input.agencyId, channel: 'whatsapp' })
          .first('mode', 'delaySeconds')
        const delayRaw = Number(arSettings?.delaySeconds ?? 0)
        const delaySeconds = Number.isFinite(delayRaw) ? Math.min(Math.max(Math.floor(delayRaw), 0), 3600) : 0
        const reason = arSettings?.mode === 'qualify' ? 'qualify_turn' : 'first_contact'
        const jobId = await enqueueAutoResponse(trx, {
          agencyId: input.agencyId,
          conversationId,
          leadId: input.leadId,
          channel: 'whatsapp',
          triggerSequence: sequence,
          reason,
          delaySeconds,
        })
        waTrace(
          'JOB_CREATED',
          { conversationId, agencyId: input.agencyId, jobId, messageId, triggerSequence: sequence },
          { jobId, reason, triggerSequence: sequence, enqueued: jobId != null },
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

    return { conversationId, messageId, inserted }
  })
}
