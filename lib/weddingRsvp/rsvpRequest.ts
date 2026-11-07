import { resolveWhatsappOutboundTargetForConversation } from '@/lib/inbox/whatsappOutboundTarget'
import { persistOutboundWhatsapp } from '@/lib/inbox/persistOutboundWhatsapp'
import { recordHumanTakeover } from '@/lib/inbox/humanTakeover'
import { sendWhatsappTemplate } from '@/lib/whatsapp/sendTemplateMessage'
import { toIsraeliWhatsappRecipient } from '@/lib/whatsapp/israeliPhone'
import {
  RSVP_REQUEST_KIND,
  RSVP_TEMPLATE_LANGUAGE,
  RSVP_TEMPLATE_NAME,
  RSVP_TEMPLATE_PAYLOADS,
  RSVP_TEMPLATE_STORED_TEXT,
  isWeddingAgency,
} from '@/lib/weddingRsvp/config'
import { countInvitesSent } from '@/lib/weddingRsvp/inviteData'
import { ensureInviteRecipient, type CreateInviteLead } from '@/lib/weddingRsvp/inviteRecipient'
import { countRsvpRequestsSent, withRsvpRequestLock } from '@/lib/weddingRsvp/rsvpRequestData'

export type SendRsvpRequestResult = { ok: true; wamid: string; messageId: number; conversationId: number } | { ok: false; error: string; code?: string }

const ISRAELI_MOBILE = /^9725\d{8}$/

/**
 * Send the approved `wedding_rsvp` TEMPLATE to ONE invited guest. A template, so it
 * needs no open 24-hour window. Under one advisory lock per guest:
 *
 *   wedding agency only → Israeli mobile → must already be invited (any path) →
 *   must not already have been asked (template or the older free-form RSVP) →
 *   conversation/Lead → human takeover → SEND with our button payloads → persist
 *   only on a wamid, tagged kind=wedding_rsvp_request (+ the caller's request id).
 *
 * The template name, language, body and buttons are fixed here; nothing about the
 * message comes from the caller except which guest.
 */
export async function sendWeddingRsvpRequest(args: {
  agencyId: number
  userId: number
  phone: string
  firstName: string
  lastName: string
  correlationId: string
  createLead?: CreateInviteLead
}): Promise<SendRsvpRequestResult> {
  if (!isWeddingAgency(args.agencyId)) return { ok: false, error: 'agency-not-allowed' }
  const waId = toIsraeliWhatsappRecipient(args.phone)
  if (!ISRAELI_MOBILE.test(waId)) return { ok: false, error: 'invalid-phone' }

  return withRsvpRequestLock(args.agencyId, waId, async (): Promise<SendRsvpRequestResult> => {
    if ((await countInvitesSent(args.agencyId, waId)) === 0) return { ok: false, error: 'not-invited' }
    if ((await countRsvpRequestsSent(args.agencyId, waId)) > 0) return { ok: false, error: 'already-requested' }

    const ensured = await ensureInviteRecipient({
      agencyId: args.agencyId,
      userId: args.userId,
      waId,
      // Only used if the invited guest somehow has no Lead yet.
      firstName: args.firstName.trim() || 'אורח חתונה',
      lastName: args.lastName.trim(),
      createLead: args.createLead,
    })
    if (ensured.ok === false) return { ok: false, error: ensured.error }
    const { recipient } = ensured

    const resolved = await resolveWhatsappOutboundTargetForConversation(args.agencyId, recipient.leadId, recipient.conversationId)
    if (resolved.ok === false) return { ok: false, error: resolved.reason }
    const { target } = resolved
    if (toIsraeliWhatsappRecipient(target.customerWaId) !== waId) return { ok: false, error: 'recipient-mismatch' }

    await recordHumanTakeover({ agencyId: args.agencyId, leadId: recipient.leadId, conversationId: recipient.conversationId })

    const sent = await sendWhatsappTemplate({
      consent: { kind: 'automated', agencyId: args.agencyId },
      phoneNumberId: target.businessPhoneNumberId,
      accessToken: target.accessToken,
      to: target.customerWaId,
      name: RSVP_TEMPLATE_NAME,
      language: RSVP_TEMPLATE_LANGUAGE,
      params: [],
      quickReplyPayloads: [...RSVP_TEMPLATE_PAYLOADS],
    })
    if ('error' in sent) return { ok: false, error: sent.error, code: sent.code }

    const persisted = await persistOutboundWhatsapp({
      agencyId: args.agencyId,
      leadId: recipient.leadId,
      businessPhoneNumberId: target.businessPhoneNumberId,
      customerWaId: target.customerWaId,
      customerName: target.customerName,
      sentByUserId: args.userId,
      wamid: sent.wamid,
      text: RSVP_TEMPLATE_STORED_TEXT,
      metadata: { kind: RSVP_REQUEST_KIND, template: RSVP_TEMPLATE_NAME, weddingRsvpRequestId: args.correlationId },
    })
    return { ok: true, wamid: sent.wamid, messageId: persisted.messageId, conversationId: recipient.conversationId }
  })
}
