import { db } from '@/config/db'
import { resolveWhatsappOutboundTargetForConversation } from '@/lib/inbox/whatsappOutboundTarget'
import { persistOutboundWhatsapp } from '@/lib/inbox/persistOutboundWhatsapp'
import { recordHumanTakeover } from '@/lib/inbox/humanTakeover'
import { sendWhatsappInteractive } from '@/lib/whatsapp/sendMessage'
import { RSVP_BODY, RSVP_INTERACTIVE, RSVP_STORED_TEXT, isAllowedRecipient } from '@/lib/weddingRsvp/config'

export type SendWeddingRsvpResult =
  | { ok: true; wamid: string; messageId: number; to: string }
  | { ok: false; error: string; code?: string }

export { RSVP_STORED_TEXT }

/**
 * Send the RSVP to ONE conversation. No loops, no lists: one conversation id in,
 * one message out. The allowlist is checked against the conversation's wa_id
 * before anything is resolved or sent, and again on the resolved target.
 * Mirrors sendTemplateToLead: takeover first, SEND, persist only on a wamid.
 * A session message: Meta accepts it only inside the 24-hour window (131047).
 */
export async function sendWeddingRsvp(args: {
  agencyId: number
  conversationId: number
  sentByUserId: number
}): Promise<SendWeddingRsvpResult> {
  const conv = await db('inbox_conversations')
    .where({ id: args.conversationId, agencyId: args.agencyId, channel: 'whatsapp' })
    .first('id', 'leadId', 'customerWaId')
  if (!conv) return { ok: false, error: 'conversation-not-found' }
  if (!isAllowedRecipient(conv.customerWaId)) return { ok: false, error: 'recipient-not-allowed' }
  const leadId = Number(conv.leadId)
  if (!Number.isFinite(leadId) || leadId <= 0) return { ok: false, error: 'conversation-has-no-lead' }

  const resolved = await resolveWhatsappOutboundTargetForConversation(args.agencyId, leadId, args.conversationId)
  if (resolved.ok === false) return { ok: false, error: resolved.reason }
  const { target } = resolved
  if (!isAllowedRecipient(target.customerWaId)) return { ok: false, error: 'recipient-not-allowed' }

  await recordHumanTakeover({ agencyId: args.agencyId, leadId, conversationId: args.conversationId })

  const sent = await sendWhatsappInteractive({
    phoneNumberId: target.businessPhoneNumberId,
    accessToken: target.accessToken,
    to: target.customerWaId,
    body: RSVP_BODY,
    interactive: RSVP_INTERACTIVE,
  })
  if ('error' in sent) return { ok: false, error: sent.error, code: sent.code }

  const persisted = await persistOutboundWhatsapp({
    agencyId: args.agencyId,
    leadId,
    businessPhoneNumberId: target.businessPhoneNumberId,
    customerWaId: target.customerWaId,
    customerName: target.customerName,
    sentByUserId: args.sentByUserId,
    wamid: sent.wamid,
    text: RSVP_STORED_TEXT,
  })
  return { ok: true, wamid: sent.wamid, messageId: persisted.messageId, to: target.customerWaId }
}
