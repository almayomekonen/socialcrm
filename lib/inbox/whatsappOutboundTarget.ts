import { db } from '@/config/db'

/**
 * Shared WhatsApp outbound targeting — same rules as the historical
 * `sendWhatsappReply` path: prefer an existing conversation's business number +
 * customer wa_id; otherwise fall back to the agency connection + lead phone.
 *
 * Used by send and by ensure-conversation (Inbox open). Do not re-implement
 * this filter elsewhere.
 */

export type WhatsappOutboundTarget = {
  leadId: number
  leadName: string | null
  businessPhoneNumberId: string
  accessToken: string
  customerWaId: string
  customerName: string | null
}

export type ResolveWhatsappOutboundTargetResult =
  | { ok: true; target: WhatsappOutboundTarget }
  | { ok: false; reason: 'lead-not-found' | 'no-connection' | 'no-recipient' }

export async function resolveWhatsappOutboundTarget(
  agencyId: number,
  leadId: number,
): Promise<ResolveWhatsappOutboundTargetResult> {
  const lead = await db('clients').where({ id: leadId, agencyId }).first('id', 'phone', 'name')
  if (!lead) return { ok: false, reason: 'lead-not-found' }

  const conv = await db('inbox_conversations')
    .where({ leadId, agencyId, channel: 'whatsapp' })
    .orderByRaw('"lastMessageAt" DESC NULLS LAST')
    .orderBy('id', 'desc')
    .first('businessPhoneNumberId', 'customerWaId', 'customerName')

  let businessPhoneNumberId: string | undefined = conv?.businessPhoneNumberId
  let connection: { phone_number_id: string; access_token: string } | undefined
  if (businessPhoneNumberId) {
    connection = await db('whatsapp_connections')
      .where({ phone_number_id: businessPhoneNumberId, agency_id: agencyId })
      .first('phone_number_id', 'access_token')
  } else {
    connection = await db('whatsapp_connections')
      .where({ agency_id: agencyId })
      .first('phone_number_id', 'access_token')
    businessPhoneNumberId = connection?.phone_number_id
  }
  if (!connection || !businessPhoneNumberId) return { ok: false, reason: 'no-connection' }

  const leadPhoneDigits = String(lead.phone ?? '').replace(/\D/g, '')
  const customerWaId = conv?.customerWaId || (leadPhoneDigits.length >= 9 ? leadPhoneDigits : '')
  if (!customerWaId) return { ok: false, reason: 'no-recipient' }

  return {
    ok: true,
    target: {
      leadId,
      leadName: (lead.name as string | null) ?? null,
      businessPhoneNumberId,
      accessToken: connection.access_token,
      customerWaId,
      customerName: (conv?.customerName as string | null) ?? (lead.name as string | null) ?? null,
    },
  }
}
