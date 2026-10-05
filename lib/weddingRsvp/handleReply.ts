import { resolveWhatsappOutboundTargetForConversation } from '@/lib/inbox/whatsappOutboundTarget'
import { persistOutboundWhatsapp } from '@/lib/inbox/persistOutboundWhatsapp'
import { sendWhatsappText } from '@/lib/whatsapp/sendMessage'
import { REPLY_ATTENDING, REPLY_NOT_ATTENDING, WEDDING_RSVP_SOURCE, isAllowedRecipient } from '@/lib/weddingRsvp/config'
import { getWeddingRsvpChoice, type WeddingRsvpChoice } from '@/lib/weddingRsvp/choice'

export type WeddingRsvpRouteResult =
  | { handled: false }
  | { handled: true; choice: WeddingRsvpChoice; replied: boolean; reason?: string }

/**
 * Webhook hook. Called for every NEWLY inserted inbound `interactive` message; returns
 * `{ handled: false }` immediately unless the message is a tap on one of the two
 * wedding buttons. The tap itself is already stored by the normal ingest (type
 * 'interactive', title as text, id in payload). This only sends the follow-up text and
 * stores it in the same conversation. Never throws: the webhook must stay 200.
 *
 * The head-count answer needs no state: it arrives as an ordinary text message
 * right after REPLY_ATTENDING and is stored by the normal ingest.
 */
export async function routeWeddingRsvpReply(args: {
  agencyId: number
  conversationId: number
  leadId: number | null
  rawMessage: unknown
}): Promise<WeddingRsvpRouteResult> {
  const choice = getWeddingRsvpChoice(args.rawMessage)
  if (!choice) return { handled: false }

  try {
    if (args.leadId == null || args.leadId <= 0) return { handled: true, choice, replied: false, reason: 'no-lead' }

    const resolved = await resolveWhatsappOutboundTargetForConversation(args.agencyId, args.leadId, args.conversationId)
    if (resolved.ok === false) return { handled: true, choice, replied: false, reason: resolved.reason }
    const { target } = resolved
    if (!isAllowedRecipient(target.customerWaId)) {
      return { handled: true, choice, replied: false, reason: 'recipient-not-allowed' }
    }

    const body = choice === 'attending' ? REPLY_ATTENDING : REPLY_NOT_ATTENDING
    const sent = await sendWhatsappText({
      phoneNumberId: target.businessPhoneNumberId,
      accessToken: target.accessToken,
      to: target.customerWaId,
      body,
    })
    if ('error' in sent) {
      console.error('[WeddingRsvp] follow-up send failed', { conversationId: args.conversationId, code: sent.code })
      return { handled: true, choice, replied: false, reason: 'send-failed' }
    }

    await persistOutboundWhatsapp({
      agencyId: args.agencyId,
      leadId: args.leadId,
      businessPhoneNumberId: target.businessPhoneNumberId,
      customerWaId: target.customerWaId,
      customerName: target.customerName,
      sentByUserId: null,
      wamid: sent.wamid,
      text: body,
      metadata: { source: WEDDING_RSVP_SOURCE },
    })
    console.log(`[WeddingRsvp] conv=${args.conversationId} choice=${choice} replied wamid=${sent.wamid}`)
    return { handled: true, choice, replied: true }
  } catch (err) {
    console.error('[WeddingRsvp] reply handling failed', { conversationId: args.conversationId, err: String(err) })
    return { handled: true, choice, replied: false, reason: 'error' }
  }
}
