/**
 * Single IRE outbound send+persist path. Customer-facing text is finalized here
 * so qualify, handoff, fallback, and post-handoff cannot bypass the no-dash rule.
 */
import { db } from '@/config/db'
import { persistOutboundWhatsapp } from '@/lib/inbox/persistOutboundWhatsapp'
import { applyIreWhatsappSendFailure } from '@/lib/inbox/onWhatsappSendFailure'
import { sendWhatsappText, formatWhatsappSendFailure } from '@/lib/whatsapp/sendMessage'
import { resolveWhatsappAccessToken } from '@/lib/whatsapp/connectionToken'
import type { AutoResponseJob } from '@/db/autoResponseJobs'
import { finalizeCustomerFacingText } from './customerFacingText'

export type IreOutboundCtx = {
  conv: { id: number; businessPhoneNumberId: string; customerWaId: string | null; customerName: string | null }
  lead: { userId: number | null; handlerId: number | null }
}

export async function sendIreOutbound(
  job: AutoResponseJob,
  ctx: IreOutboundCtx,
  send: typeof sendWhatsappText,
  text: string,
  metadata: { source: string; reason: string; phase: number; kind?: string } = {
    source: 'auto_response',
    reason: job.reason,
    phase: 2,
  },
): Promise<{ ok: true; messageId: number; sequence: number } | { ok: false; reason: string; settled?: true }> {
  const body = finalizeCustomerFacingText(text)
  const connection = await db('whatsapp_connections')
    .where({ phone_number_id: ctx.conv.businessPhoneNumberId, agency_id: job.agencyId })
    .first('phone_number_id', 'access_token', 'user_id')
  if (!connection) return { ok: false, reason: 'no_connection' }
  const to = ctx.conv.customerWaId
  if (!to) return { ok: false, reason: 'no_recipient' }

  const sentByUserId = ctx.lead.userId ?? ctx.lead.handlerId ?? connection.user_id
  const sent = await send({
    phoneNumberId: ctx.conv.businessPhoneNumberId,
    accessToken: resolveWhatsappAccessToken(connection.access_token),
    to,
    body,
    trace: { conversationId: ctx.conv.id, jobId: job.id, agencyId: job.agencyId, triggerSequence: job.triggerSequence },
  })
  if (sent.ok === false) {
    await applyIreWhatsappSendFailure(job, sent, {
      businessPhoneNumberId: ctx.conv.businessPhoneNumberId,
      customerWaId: to,
      customerName: ctx.conv.customerName ?? null,
      sentByUserId,
      text: body,
    })
    return { ok: false, reason: formatWhatsappSendFailure(sent), settled: true }
  }
  const res = await persistOutboundWhatsapp({
    agencyId: job.agencyId,
    leadId: job.leadId,
    businessPhoneNumberId: ctx.conv.businessPhoneNumberId,
    customerWaId: to,
    customerName: ctx.conv.customerName ?? null,
    sentByUserId,
    wamid: sent.wamid,
    text: body,
  })
  await db('inbox_messages')
    .where({ id: res.messageId })
    .update({
      metadata: db.raw(`metadata || ?::jsonb`, [JSON.stringify(metadata)]),
    })
  return { ok: true, messageId: res.messageId, sequence: Number(res.sequence) || 0 }
}
