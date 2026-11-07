import { resolveWhatsappOutboundTargetForConversation } from '@/lib/inbox/whatsappOutboundTarget'
import { persistOutboundWhatsapp } from '@/lib/inbox/persistOutboundWhatsapp'
import { sendWhatsappText } from '@/lib/whatsapp/sendMessage'
import { WEDDING_RSVP_SOURCE } from '@/lib/weddingRsvp/config'
import { followUpAllowed } from '@/lib/weddingRsvp/followUpAccess'

export type ReplyOutcome = { replied: true } | { replied: false; reason: string }

/**
 * One automatic follow-up text in an existing conversation: resolve the target,
 * enforce followUpAllowed (allowlist, or a template RSVP request here), SEND, persist only on a wamid with metadata.source
 * 'wedding_rsvp' (so it never reads as a human reply).
 */
export async function replyInConversation(args: {
  agencyId: number
  conversationId: number
  leadId: number | null
  body: string
  metadata?: Record<string, unknown>
}): Promise<ReplyOutcome> {
  if (args.leadId == null || args.leadId <= 0) return { replied: false, reason: 'no-lead' }

  const resolved = await resolveWhatsappOutboundTargetForConversation(args.agencyId, args.leadId, args.conversationId)
  if (resolved.ok === false) return { replied: false, reason: resolved.reason }
  const { target } = resolved
  if (!(await followUpAllowed(target.customerWaId, args.conversationId))) return { replied: false, reason: 'recipient-not-allowed' }

  const sent = await sendWhatsappText({
      consent: { kind: 'automated', agencyId: args.agencyId },
    phoneNumberId: target.businessPhoneNumberId,
    accessToken: target.accessToken,
    to: target.customerWaId,
    body: args.body,
  })
  if ('error' in sent) {
    console.error('[WeddingRsvp] follow-up send failed', { conversationId: args.conversationId, code: sent.code })
    return { replied: false, reason: 'send-failed' }
  }

  await persistOutboundWhatsapp({
    agencyId: args.agencyId,
    leadId: args.leadId,
    businessPhoneNumberId: target.businessPhoneNumberId,
    customerWaId: target.customerWaId,
    customerName: target.customerName,
    sentByUserId: null,
    wamid: sent.wamid,
    text: args.body,
    metadata: { ...args.metadata, source: WEDDING_RSVP_SOURCE },
  })
  console.log(`[WeddingRsvp] conv=${args.conversationId} replied wamid=${sent.wamid}`)
  return { replied: true }
}
