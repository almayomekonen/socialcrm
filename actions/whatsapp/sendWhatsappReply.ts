'use server'

import { requireAgencyUser } from '@/lib/requireUser'
import { db } from '@/config/db'
import { sendWhatsappText } from '@/lib/whatsapp/sendMessage'
import { persistOutboundWhatsapp } from '@/lib/inbox/persistOutboundWhatsapp'

/**
 * Send an outbound WhatsApp reply for a lead and persist it on success.
 *
 * Order is deliberate: SEND first, persist only on a confirmed wamid — so a
 * failed Cloud API call never leaves a fake conversation entry. Reuses the
 * existing whatsapp_connections (replying from the same business number the
 * customer messaged) and the existing conversation model.
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

  // Lead must belong to the caller's agency. Phone is the recipient fallback.
  const lead = await db('clients').where({ id: leadId, agencyId: user.agencyId }).first('id', 'phone', 'name')
  if (!lead) return { ok: false, reason: 'lead-not-found' }

  // Prefer the existing thread: reply from the same business number, to the same
  // customer wa_id the inbound came from.
  const conv = await db('inbox_conversations')
    .where({ leadId, agencyId: user.agencyId, channel: 'whatsapp' })
    .first('businessPhoneNumberId', 'customerWaId', 'customerName')

  let businessPhoneNumberId: string | undefined = conv?.businessPhoneNumberId
  let connection: { phone_number_id: string; access_token: string } | undefined
  if (businessPhoneNumberId) {
    connection = await db('whatsapp_connections')
      .where({ phone_number_id: businessPhoneNumberId, agency_id: user.agencyId })
      .first('phone_number_id', 'access_token')
  } else {
    connection = await db('whatsapp_connections')
      .where({ agency_id: user.agencyId })
      .first('phone_number_id', 'access_token')
    businessPhoneNumberId = connection?.phone_number_id
  }
  if (!connection || !businessPhoneNumberId) return { ok: false, reason: 'no-connection' }

  const leadPhoneDigits = String(lead.phone ?? '').replace(/\D/g, '')
  const to = conv?.customerWaId || (leadPhoneDigits.length >= 9 ? leadPhoneDigits : '')
  if (!to) return { ok: false, reason: 'no-recipient' }

  // SEND first — persist only on a confirmed wamid.
  const sent = await sendWhatsappText({
    phoneNumberId: businessPhoneNumberId,
    accessToken: connection.access_token,
    to,
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
      businessPhoneNumberId,
      customerWaId: to,
      customerName: (conv?.customerName as string | null) ?? (lead.name as string | null) ?? null,
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
