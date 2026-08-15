'use server'

import { requireProductAccess } from '@/lib/requireUser'
import { sendWhatsappText } from '@/lib/whatsapp/sendMessage'
import { persistOutboundWhatsapp } from '@/lib/inbox/persistOutboundWhatsapp'
import { recordAccountRestriction } from '@/lib/inbox/recordAccountRestriction'
import { resolveWhatsappOutboundTarget } from '@/lib/inbox/whatsappOutboundTarget'
import { mapWhatsappError, type WhatsappErrorCategory } from '@/lib/inbox/whatsappErrorCopy'

/**
 * Send an outbound WhatsApp reply for a lead and persist it on success.
 *
 * Order is deliberate: SEND first, persist only on a confirmed wamid — so a
 * failed Cloud API call never leaves a fake conversation entry. Targeting
 * reuses `resolveWhatsappOutboundTarget` (same rules as Inbox ensure-open).
 */

const MAX_CHARS = 4096

export type SendWhatsappReplyResult =
  | { ok: true }
  | { ok: false; reason: string; category?: WhatsappErrorCategory }

export async function sendWhatsappReply(
  leadIdRaw: number | string,
  bodyRaw: string,
): Promise<SendWhatsappReplyResult> {
  const leadId = Number(leadIdRaw)
  if (!Number.isFinite(leadId) || leadId <= 0) return { ok: false, reason: 'invalid-input' }

  const body = (bodyRaw ?? '').trim()
  if (!body) return { ok: false, reason: 'empty' }
  if (body.length > MAX_CHARS) return { ok: false, reason: 'too-long' }

  const user = await requireProductAccess()

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
  if (sent.ok === false) {
    console.error(`[WhatsappSend][lead=${leadId}] send failed`, sent)
    const code = sent.code != null ? Number(sent.code) : null
    const { category } = mapWhatsappError(Number.isFinite(code) ? code : null)
    if (category === 'account') {
      try {
        await recordAccountRestriction({
          agencyId: user.agencyId,
          leadId,
          businessPhoneNumberId: target.businessPhoneNumberId,
          customerWaId: target.customerWaId,
          customerName: target.customerName,
          sentByUserId: user.id,
          text: body,
        })
      } catch (err) {
        console.error(`[WhatsappSend][lead=${leadId}] record account restriction failed`, err)
      }
    }
    return { ok: false, reason: 'send-failed', category }
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
