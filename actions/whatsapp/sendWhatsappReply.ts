'use server'

import { requireAgencyUser } from '@/lib/requireUser'
import { sendWhatsappText } from '@/lib/whatsapp/sendMessage'
import { persistOutboundWhatsapp } from '@/lib/inbox/persistOutboundWhatsapp'
import { resolveWhatsappOutboundTarget } from '@/lib/inbox/whatsappOutboundTarget'

/**
 * Send an outbound WhatsApp reply for a lead and persist it on success.
 *
 * Order is deliberate: SEND first, persist only on a confirmed wamid — so a
 * failed Cloud API call never leaves a fake conversation entry. Targeting
 * reuses `resolveWhatsappOutboundTarget` (same rules as Inbox ensure-open).
 */

const MAX_CHARS = 4096

export type SendWhatsappReplyResult = { ok: true } | { ok: false; reason: string }

export async function sendWhatsappReply(
  leadIdRaw: number | string,
  bodyRaw: string,
): Promise<SendWhatsappReplyResult> {
  const leadId = Number(leadIdRaw)
  if (!Number.isFinite(leadId) || leadId <= 0) return { ok: false, reason: 'invalid-input' }

  const body = (bodyRaw ?? '').trim()
  if (!body) return { ok: false, reason: 'empty' }
  if (body.length > MAX_CHARS) return { ok: false, reason: 'too-long' }

  const user = await requireAgencyUser()

  const resolved = await resolveWhatsappOutboundTarget(user.agencyId, leadId)
  if (resolved.ok === false) return { ok: false, reason: resolved.reason }

  const { target } = resolved

  // SEND first — persist only on a confirmed wamid.
  const sent = await sendWhatsappText({
    phoneNumberId: target.businessPhoneNumberId,
    accessToken: target.accessToken,
    to: target.customerWaId,
    body,
  })
  if (!sent.ok) {
    console.error(`[WhatsappSend][lead=${leadId}] send failed`, sent)
    return { ok: false, reason: 'send-failed' }
  }

  try {
    await persistOutboundWhatsapp({
      agencyId: user.agencyId,
      leadId,
      businessPhoneNumberId: target.businessPhoneNumberId,
      customerWaId: target.customerWaId,
      customerName: target.customerName,
      sentByUserId: user.id,
      wamid: sent.wamid,
      text: body,
    })
  } catch (err) {
    // Sent at Meta but local persist failed — surface as error and log; do not
    // silently claim success. Rare (single local transaction).
    console.error(`[WhatsappSend][lead=${leadId}] persist after successful send failed:`, err)
    return { ok: false, reason: 'persist-failed' }
  }

  return { ok: true }
}
