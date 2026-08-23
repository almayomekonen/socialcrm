'use server'

import { requireProductAccess } from '@/lib/requireUser'
import { sendWhatsappText } from '@/lib/whatsapp/sendMessage'
import { persistOutboundWhatsapp } from '@/lib/inbox/persistOutboundWhatsapp'
import { onWhatsappSendFailure } from '@/lib/inbox/onWhatsappSendFailure'
import {
  resolveWhatsappOutboundTarget,
  resolveWhatsappOutboundTargetForConversation,
} from '@/lib/inbox/whatsappOutboundTarget'
import { assertWhatsappFreeTextAllowed } from '@/lib/inbox/whatsappFreeTextGate'
import { recordHumanTakeover } from '@/lib/inbox/humanTakeover'
import type { WhatsappErrorCategory } from '@/lib/inbox/whatsappErrorCopy'

/**
 * Send an outbound WhatsApp reply for a lead and persist it on success.
 *
 * Order is deliberate: window/health gate, then SEND first, persist only on a
 * confirmed wamid — so a closed 24-hour window or a failed Cloud API call
 * never leaves a fake conversation entry. A conversation id uses that
 * conversation's phone; otherwise targeting reuses `resolveWhatsappOutboundTarget`.
 */

const MAX_CHARS = 4096

export type SendWhatsappReplyResult =
  | { ok: true }
  | { ok: false; reason: string; category?: WhatsappErrorCategory }

export async function sendWhatsappReply(
  leadIdRaw: number | string,
  bodyRaw: string,
  conversationIdRaw?: number | string | null,
): Promise<SendWhatsappReplyResult> {
  const leadId = Number(leadIdRaw)
  if (!Number.isFinite(leadId) || leadId <= 0) return { ok: false, reason: 'invalid-input' }

  const body = (bodyRaw ?? '').trim()
  if (!body) return { ok: false, reason: 'empty' }
  if (body.length > MAX_CHARS) return { ok: false, reason: 'too-long' }

  const conversationId =
    conversationIdRaw == null || conversationIdRaw === ''
      ? null
      : Number(conversationIdRaw)
  if (conversationId != null && (!Number.isFinite(conversationId) || conversationId <= 0)) {
    return { ok: false, reason: 'invalid-input' }
  }

  const user = await requireProductAccess()

  const gate = await assertWhatsappFreeTextAllowed({
    agencyId: user.agencyId,
    leadId,
    conversationId,
  })
  if (gate.ok === false) return { ok: false, reason: gate.reason }

  const resolved = conversationId
    ? await resolveWhatsappOutboundTargetForConversation(user.agencyId, leadId, conversationId)
    : await resolveWhatsappOutboundTarget(user.agencyId, leadId)
  if (resolved.ok === false) return { ok: false, reason: resolved.reason }

  const { target } = resolved

  // The rep is speaking. Stop the agent BEFORE the round trip to Meta, not after:
  // that round trip is exactly the window a worker could slip a reply through.
  await recordHumanTakeover({ agencyId: user.agencyId, leadId, conversationId })

  // SEND first — persist only on a confirmed wamid.
  const sent = await sendWhatsappText({
    phoneNumberId: target.businessPhoneNumberId,
    accessToken: target.accessToken,
    to: target.customerWaId,
    body,
  })
  if (sent.ok === false) {
    console.error(`[WhatsappSend][lead=${leadId}] send failed`, sent)
    const { category } = await onWhatsappSendFailure(sent, {
      agencyId: user.agencyId,
      leadId,
      businessPhoneNumberId: target.businessPhoneNumberId,
      customerWaId: target.customerWaId,
      customerName: target.customerName,
      sentByUserId: user.id,
      text: body,
    })
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
