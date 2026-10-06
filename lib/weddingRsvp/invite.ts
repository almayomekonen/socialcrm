import { resolveWhatsappOutboundTargetForConversation } from '@/lib/inbox/whatsappOutboundTarget'
import { persistOutboundWhatsapp } from '@/lib/inbox/persistOutboundWhatsapp'
import { recordHumanTakeover } from '@/lib/inbox/humanTakeover'
import { sendWhatsappTemplate } from '@/lib/whatsapp/sendTemplateMessage'
import { toIsraeliWhatsappRecipient } from '@/lib/whatsapp/israeliPhone'
import {
  INVITE_IMAGE_URL,
  INVITE_KIND,
  INVITE_STORED_TEXT,
  INVITE_TEMPLATE_LANGUAGE,
  INVITE_TEMPLATE_NAME,
  isWeddingAgency,
} from '@/lib/weddingRsvp/config'
import { countInvitesSent, withInviteLock } from '@/lib/weddingRsvp/inviteData'
import { ensureInviteRecipient } from '@/lib/weddingRsvp/inviteRecipient'

export type SendWeddingInviteResult =
  | {
      ok: true
      wamid: string
      messageId: number
      conversationId: number
      leadId: number
      leadCreated: boolean
      conversationCreated: boolean
      to: string
    }
  | { ok: false; error: string; code?: string }

/** Israeli mobile in 972 E.164: 9725 + 8 digits. */
const ISRAELI_MOBILE = /^9725\d{8}$/

/**
 * Send the approved `wedding_invite` template (image header + static body) to ONE
 * phone number. A template, so it needs no open 24-hour window; works for a number
 * SocialCRM has never seen. Everything runs under one advisory lock per guest:
 *
 *   wedding agency only → validate the Israeli mobile → already invited (a non-failed
 *   send by any path)? refuse → find/create Lead
 *   and conversation → human takeover (the AI agent must not answer a wedding
 *   guest) → SEND → persist only on a wamid. The existing `statuses` webhook then
 *   moves the stored row through sent → delivered → read by its wamid.
 */
export async function sendWeddingInvite(args: {
  agencyId: number
  userId: number
  phone: string
  firstName: string
  lastName: string
}): Promise<SendWeddingInviteResult> {
  if (!isWeddingAgency(args.agencyId)) return { ok: false, error: 'agency-not-allowed' }
  const waId = toIsraeliWhatsappRecipient(args.phone)
  if (!ISRAELI_MOBILE.test(waId)) return { ok: false, error: 'invalid-phone' }
  const firstName = args.firstName.trim()
  if (!firstName) return { ok: false, error: 'missing-name' }

  return withInviteLock(args.agencyId, waId, async (): Promise<SendWeddingInviteResult> => {
    if ((await countInvitesSent(args.agencyId, waId)) > 0) return { ok: false, error: 'already-invited' }

    const ensured = await ensureInviteRecipient({ ...args, waId, firstName, lastName: args.lastName.trim() })
    if (ensured.ok === false) return { ok: false, error: ensured.error }
    const { recipient } = ensured

    const resolved = await resolveWhatsappOutboundTargetForConversation(args.agencyId, recipient.leadId, recipient.conversationId)
    if (resolved.ok === false) return { ok: false, error: resolved.reason }
    const { target } = resolved
    // The send goes to the conversation's number; it must be the number asked for.
    if (toIsraeliWhatsappRecipient(target.customerWaId) !== waId) return { ok: false, error: 'recipient-mismatch' }

    await recordHumanTakeover({ agencyId: args.agencyId, leadId: recipient.leadId, conversationId: recipient.conversationId })

    const sent = await sendWhatsappTemplate({
      phoneNumberId: target.businessPhoneNumberId,
      accessToken: target.accessToken,
      to: target.customerWaId,
      name: INVITE_TEMPLATE_NAME,
      language: INVITE_TEMPLATE_LANGUAGE,
      params: [],
      headerImage: { link: INVITE_IMAGE_URL },
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
      text: INVITE_STORED_TEXT,
      metadata: { kind: INVITE_KIND, template: INVITE_TEMPLATE_NAME },
    })
    return {
      ok: true,
      wamid: sent.wamid,
      messageId: persisted.messageId,
      conversationId: recipient.conversationId,
      leadId: recipient.leadId,
      leadCreated: recipient.leadCreated,
      conversationCreated: recipient.conversationCreated,
      to: target.customerWaId,
    }
  })
}
