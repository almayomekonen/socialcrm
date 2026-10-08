/**
 * One inbound WhatsApp message, from the raw webhook object to a persisted row.
 *
 * Extracted from `app/api/webhooks/whatsapp/route.ts` unchanged in behaviour.
 * It moved for two reasons: the route was over the file-size limit before this
 * change, and a webhook payload can carry SEVERAL messages while the route only
 * ever handled `messages[0]`. Handling a batch means running this per message,
 * which means it has to be callable per message.
 *
 * WHY THE DROPPED MESSAGES MATTER MORE NOW. Under the AI agent a lost second
 * message was a lost sentence: the next turn re-read the whole transcript and
 * usually recovered. A questionnaire asks one question and waits for one
 * answer. If the answer arrives batched behind another message and is never
 * persisted, nothing recovers it — the customer answered and the conversation
 * sits there.
 *
 * Every step is idempotent, so re-running this for a redelivered payload is
 * safe: lead creation dedups on `leadSource = whatsapp:{wamid}`, and the
 * message insert dedups on `(channel, externalId)`.
 */
import { db } from '@/config/db'
import { parseWhatsappLead } from '@/lib/adapters/whatsappLead'
import { createLeadFromWhatsappWebhook } from '@/lib/system/createLeadFromWhatsappWebhook'
import { ingestWhatsappInbound } from '@/lib/inbox/ingestWhatsappInbound'
import { waTrace } from '@/lib/inbox/autoresponse/waTrace'
import { notifyWhatsappIngestionFailed } from '@/lib/whatsapp/integrationNotifications'
import { canUseWhatsappContacts } from '@/lib/flags/whatsappContactsFlags'
import { hasCtwaReferral } from '@/lib/whatsapp/classifyInbound'
import { findClientsByPhoneCore } from '@/lib/whatsapp/matchLeadByPhone'
import { resolveInboundLeadDecision } from '@/lib/whatsapp/resolveInboundLead'
import { attachConversationToLead, getConversationMemory } from '@/db/inboxConversations'
import { shouldPromoteContactToLead } from '@/lib/inbox/autoresponse/contactLeadPromotion'
import { routeWeddingRsvpReply } from '@/lib/weddingRsvp/handleReply'

export type InboundWebhookConnection = {
  agency_id: number | string
  user_id: number
}

export type HandleInboundResult = {
  /** True when a durable auto-response job was created and a drain is owed. */
  kick: boolean
  /** The job's configured delay, so the caller can wait before draining. */
  delaySeconds: number
}

export async function handleInboundWebhookMessage(args: {
  message: { id?: string; from?: string; text?: { body?: string } } & Record<string, unknown>
  phoneNumberId: string
  profileName: string | null
  connection: InboundWebhookConnection
}): Promise<HandleInboundResult> {
  const { message, phoneNumberId, profileName, connection } = args
  const messageId = message.id as string
  const from = message.from as string
  const agencyId = Number(connection.agency_id)

  waTrace(
    'WEBHOOK_RECEIVED',
    { agencyId, messageId },
    { phoneNumber: from, phoneNumberId, waMessageId: messageId, textLength: (message?.text?.body ?? '').length },
  )

  const { firstName, lastName, phone } = parseWhatsappLead(from, profileName)
  const contactsOn = canUseWhatsappContacts(agencyId)

  let leadId: number | null = null

  if (!contactsOn) {
    const lead = await createLeadFromWhatsappWebhook({
      firstName,
      lastName,
      phone,
      messageId,
      agencyId,
      userId: connection.user_id,
    })
    if (!lead) {
      console.error(`[WhatsappWebhook][create][msgId=${messageId}] createLeadFromWhatsappWebhook returned null`)
      await notifyWhatsappIngestionFailed(connection as never, messageId).catch(() => {})
      return { kick: false, delaySeconds: 0 }
    }
    leadId = Number(lead.id)
    console.log(`[WhatsappWebhook][success][msgId=${messageId}] lead id=${leadId}`)
  } else {
    const memory = await getConversationMemory(agencyId, phoneNumberId, from)
    const matches =
      memory?.isPersonal || (memory?.leadId != null && memory.leadId > 0)
        ? []
        : await findClientsByPhoneCore(agencyId, from)
    const decision = resolveInboundLeadDecision({
      isPersonal: memory?.isPersonal === true,
      leadId: memory?.leadId ?? null,
      matchingLeadIds: matches.map((m) => m.id),
      hasCtwaReferral: hasCtwaReferral(message),
    })

    if (decision.kind === 'remembered_lead' || decision.kind === 'auto_link') {
      leadId = decision.leadId
    } else if (decision.kind === 'auto_create_ctwa') {
      const lead = await createLeadFromWhatsappWebhook({
        firstName,
        lastName,
        phone,
        messageId,
        agencyId,
        userId: connection.user_id,
      })
      if (lead) {
        leadId = Number(lead.id)
      } else {
        console.error(`[WhatsappWebhook][create][msgId=${messageId}] CTWA createLead returned null`)
        await notifyWhatsappIngestionFailed(connection as never, messageId).catch(() => {})
      }
    } else if (decision.kind === 'contact') {
      const inboundText = typeof message?.text?.body === 'string' ? message.text.body : ''
      if (shouldPromoteContactToLead(inboundText)) {
        const latest = await getConversationMemory(agencyId, phoneNumberId, from)
        if (latest?.isPersonal === true) {
          leadId = null
        } else if (latest?.leadId != null && latest.leadId > 0) {
          leadId = latest.leadId
        } else if (matches.length === 1) {
          leadId = matches[0].id
        } else if (matches.length === 0) {
          const lead = await createLeadFromWhatsappWebhook({
            firstName,
            lastName,
            phone,
            messageId,
            agencyId,
            userId: connection.user_id,
          })
          if (lead) leadId = Number(lead.id)
        }
      }
    }

    console.log(`[WhatsappWebhook][decision][msgId=${messageId}] kind=${decision.kind} leadId=${leadId ?? 'null'}`)
  }

  // Persist the message regardless of Lead/contact. Isolated so any failure
  // here never affects the 200 to Meta. Coexistence history never reaches here.
  try {
    const result = await ingestWhatsappInbound({
      agencyId,
      leadId,
      businessPhoneNumberId: phoneNumberId,
      customerWaId: from,
      customerName: profileName,
      rawMessage: message,
    })
    console.log(
      `[WhatsappWebhook][inbox][msgId=${messageId}] conversation=${result.conversationId} message=${result.messageId} inserted=${result.inserted} leadId=${leadId ?? 'null'}`,
    )

    if (leadId != null && leadId > 0) {
      await attachConversationToLead(db, { conversationId: result.conversationId, agencyId, leadId }).catch((err) => {
        console.error(`[WhatsappWebhook][attach][msgId=${messageId}]`, err)
      })
    }

    // TEMPORARY wedding RSVP hook (lib/weddingRsvp). Returns at once unless the
    // message is a tap on its buttons or a head-count answer; never throws.
    if (result.inserted && (message.type === 'interactive' || message.type === 'button' || message.type === 'text')) {
      await routeWeddingRsvpReply({
        agencyId,
        conversationId: result.conversationId,
        leadId,
        messageId: result.messageId,
        rawMessage: message,
      })
    }

    if (result.inserted && result.ireEnqueued) {
      console.log(`[IRE] kick owed conv=${result.conversationId} msg=${result.messageId}`)
      return { kick: true, delaySeconds: result.autoResponseDelaySeconds ?? 0 }
    }
  } catch (err) {
    console.error(`[WhatsappWebhook][inbox][msgId=${messageId}] persistence failed:`, err)
  }

  return { kick: false, delaySeconds: 0 }
}
