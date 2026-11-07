/**
 * Single IRE outbound send+persist path. Customer-facing text is finalized here
 * so qualify, handoff, fallback, and post-handoff cannot bypass the no-dash rule.
 */
import { db } from '@/config/db'
import { persistOutboundWhatsapp } from '@/lib/inbox/persistOutboundWhatsapp'
import { applyIreWhatsappSendFailure } from '@/lib/inbox/onWhatsappSendFailure'
import { sendWhatsappText, formatWhatsappSendFailure } from '@/lib/whatsapp/sendMessage'
import { resolveWhatsappAccessToken } from '@/lib/whatsapp/connectionToken'
import { isOptOutBlocked } from '@/lib/whatsapp/optOut/sendGate'
import type { AutoResponseJob } from '@/db/autoResponseJobs'
import { finalizeCustomerFacingText } from './customerFacingText'
import { assertIreSendAllowed } from './ireSendGate'
import { assertAgentSendAllowed } from './agentSendGuard'

export type IreOutboundCtx = {
  conv: { id: number; businessPhoneNumberId: string; customerWaId: string | null; customerName: string | null }
  lead: { userId: number | null; handlerId: number | null }
}

export async function sendIreOutbound(
  job: AutoResponseJob,
  ctx: IreOutboundCtx,
  send: typeof sendWhatsappText,
  text: string,
  metadata: { source: string; reason: string; phase: number; kind?: string; [key: string]: unknown } = {
    source: 'auto_response',
    reason: job.reason,
    phase: 2,
  },
  opts: {
    /** Abandon the Graph call after this long. See sendWhatsappText.timeoutMs. */
    timeoutMs?: number
    /** Do not enqueue the Copilot analysis job for this message (an LLM call). */
    skipAnalysis?: boolean
  } = {},
): Promise<
  | { ok: true; messageId: number; sequence: number }
  | { ok: false; reason: string; settled?: true; ambiguous?: true }
> {
  const body = finalizeCustomerFacingText(text)
  const connection = await db('whatsapp_connections')
    .where({ phone_number_id: ctx.conv.businessPhoneNumberId, agency_id: job.agencyId })
    .first('phone_number_id', 'access_token', 'user_id')
  if (!connection) return { ok: false, reason: 'no_connection' }
  const to = ctx.conv.customerWaId
  if (!to) return { ok: false, reason: 'no_recipient' }

  const sendGate = await assertIreSendAllowed(job.agencyId, job.conversationId)
  if (sendGate.ok === false) return { ok: false, reason: sendGate.reason }

  // ── HUMAN PRESENCE (second of two send guards) ─────────────────────────────
  // Runs after the IRE gate, immediately before Meta. The IRE gate answers "is
  // this a legitimate conversation to send on"; this answers "does the agent
  // still own this turn". Both must authorize. Fresh read, no cached verdict —
  // the whole point is that the world may have changed while the model ran.
  const presence = await assertAgentSendAllowed({
    conversationId: job.conversationId,
    turnStartedAt: job.createdAt,
    trace: {
      conversationId: ctx.conv.id,
      jobId: job.id,
      agencyId: job.agencyId,
      triggerSequence: job.triggerSequence,
    },
  })
  if (presence.authorized === false) return { ok: false, reason: presence.reason }

  const sentByUserId = ctx.lead.userId ?? ctx.lead.handlerId ?? connection.user_id
  const sent = await send({
    phoneNumberId: ctx.conv.businessPhoneNumberId,
    accessToken: resolveWhatsappAccessToken(connection.access_token),
    to,
    body,
    consent: { kind: 'automated', agencyId: job.agencyId },
    trace: { conversationId: ctx.conv.id, jobId: job.id, agencyId: job.agencyId, triggerSequence: job.triggerSequence },
    ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}),
  })
  // The customer opted out of this business: nothing reached Meta. A plain
  // (unsettled) failure, so every caller ends the job as a skip — never a retry,
  // never a failed-message bubble.
  if (isOptOutBlocked(sent)) return { ok: false, reason: 'opted_out' }
  if (sent.ok === false) {
    await applyIreWhatsappSendFailure(job, sent, {
      businessPhoneNumberId: ctx.conv.businessPhoneNumberId,
      customerWaId: to,
      customerName: ctx.conv.customerName ?? null,
      sentByUserId,
      text: body,
    })
    // `ambiguous` travels with the failure: a timeout or a dropped connection
    // may still have been delivered, and a caller that resends on it can put a
    // second copy of the same message on the customer's phone.
    return {
      ok: false,
      reason: formatWhatsappSendFailure(sent),
      settled: true,
      ...(sent.ambiguous ? { ambiguous: true as const } : {}),
    }
  }
  // The tag goes in with the row. It used to be merged by a second UPDATE, and
  // a process that died in between left an outbound that every reader treats as
  // a human takeover — permanently silencing the automation on that thread.
  const res = await persistOutboundWhatsapp({
    agencyId: job.agencyId,
    leadId: job.leadId,
    businessPhoneNumberId: ctx.conv.businessPhoneNumberId,
    customerWaId: to,
    customerName: ctx.conv.customerName ?? null,
    sentByUserId,
    wamid: sent.wamid,
    text: body,
    metadata,
    skipAnalysis: opts.skipAnalysis === true,
  })
  return { ok: true, messageId: res.messageId, sequence: Number(res.sequence) || 0 }
}
