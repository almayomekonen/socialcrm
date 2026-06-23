/**
 * Instant Response Engine worker (Phase 1). Drains auto_response_jobs: claim
 * (SKIP LOCKED) → authoritative eligibility re-check → guardrailed AI generate →
 * deterministic validate → send via the existing WhatsApp path → mark + audit.
 * Invoked by the post-commit kick (primary) and the cron backstop. Mirrors
 * lib/inbox/intelligence/worker.ts.
 */
import { db } from '@/config/db'
import { sendWhatsappText } from '@/lib/whatsapp/sendMessage'
import { persistOutboundWhatsapp } from '@/lib/inbox/persistOutboundWhatsapp'
import { track } from '@/lib/analytics/track'
import { getMasterEnabled, getChannelSettings } from '@/db/autoResponseSettings'
import {
  claimAutoResponseJobs,
  reclaimStaleAutoResponseJobs,
  completeAutoResponseJob,
  skipAutoResponseJob,
  failAutoResponseJob,
  countSentToday,
  hasSentFirstContact,
  type AutoResponseJob,
} from '@/db/autoResponseJobs'
import { decideEligibility } from './eligibility'
import { generateAcknowledgement } from './generate'
import { validateAutoResponse } from './validate'

const TERMINAL_STATUSES = ['closed', 'lost']
const DEFAULT_LEASE_MS = 60_000

type QuietHours = { tz?: string; startHour?: number; endHour?: number }

function withinQuietHours(qh: QuietHours | undefined, now: Date): boolean {
  if (qh?.startHour == null || qh?.endHour == null) return false
  const tz = qh.tz || 'Asia/Jerusalem'
  const hour = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: tz }).format(now))
  return qh.startHour <= qh.endHour
    ? hour >= qh.startHour && hour < qh.endHour
    : hour >= qh.startHour || hour < qh.endHour
}

type Outcome = 'sent' | 'skipped' | 'failed'

async function processJob(job: AutoResponseJob): Promise<Outcome> {
  const doSkip = async (reason: string): Promise<Outcome> => {
    await skipAutoResponseJob(job.id, reason)
    await track({ agencyId: job.agencyId, event: 'auto_response_skipped', props: { conversationId: job.conversationId, reason } })
    return 'skipped'
  }

  const [master, settings, conv, lead] = await Promise.all([
    getMasterEnabled(job.agencyId),
    getChannelSettings(job.agencyId, job.channel),
    db('inbox_conversations').where({ id: job.conversationId })
      .first('id', 'businessPhoneNumberId', 'customerWaId', 'customerName', 'lastMessageText'),
    db('clients').where({ id: job.leadId }).first('id', 'userId', 'handlerId', 'status'),
  ])
  if (!conv) return doSkip('conversation_gone')
  if (!lead) return doSkip('lead_gone')
  if (lead.status && TERMINAL_STATUSES.includes(lead.status)) return doSkip('lead_terminal')

  const [outboundExists, humanReplyExists, priorAuto, sentToday] = await Promise.all([
    db('inbox_messages').where({ conversationId: job.conversationId, direction: 'outbound' }).first('id'),
    db('inbox_messages').where({ conversationId: job.conversationId, direction: 'outbound' }).whereNotNull('sentByUserId').first('id'),
    hasSentFirstContact(job.conversationId),
    countSentToday(job.agencyId),
  ])

  const elig = decideEligibility({
    masterEnabled: master,
    channelEnabled: settings?.enabled ?? false,
    hasPriorOutbound: !!outboundExists,
    hasPriorHumanReply: !!humanReplyExists,
    hasPriorAutoFirstContact: priorAuto,
    withinQuietHours: withinQuietHours(settings?.quietHours, new Date()),
    sentTodayForAgency: sentToday,
    dailyCap: settings?.dailyCap ?? 0,
  })
  if (elig.shouldRespond === false) return doSkip(elig.skipReason)

  // Generate, with one retry if the guardrail validator rejects the draft.
  let message: string | null = null
  for (let attempt = 0; attempt < 2 && !message; attempt++) {
    const gen = await generateAcknowledgement({
      agencyId: job.agencyId,
      customerName: (conv.customerName as string | null) ?? null,
      lastCustomerMessage: (conv.lastMessageText as string | null) ?? '',
      guidance: settings?.guidance ?? null,
    })
    if (gen.ok === false) return doSkip(gen.skipReason)
    if (validateAutoResponse(gen.message).ok) message = gen.message
  }
  if (!message) return doSkip('validation_failed')

  const connection = await db('whatsapp_connections')
    .where({ phone_number_id: conv.businessPhoneNumberId, agency_id: job.agencyId })
    .first('phone_number_id', 'access_token', 'user_id')
  if (!connection) return doSkip('no_connection')
  const to = conv.customerWaId as string | null
  if (!to) return doSkip('no_recipient')

  // SEND first — persist only on a confirmed wamid (same discipline as sendWhatsappReply).
  const sent = await sendWhatsappText({
    phoneNumberId: conv.businessPhoneNumberId as string,
    accessToken: connection.access_token,
    to,
    body: message,
  })
  if (!sent.ok) {
    await failAutoResponseJob(job.id, 'send-failed')
    return 'failed'
  }

  const sentByUserId = (lead.userId as number | null) ?? (lead.handlerId as number | null) ?? connection.user_id
  let messageId: number | null = null
  try {
    const res = await persistOutboundWhatsapp({
      agencyId: job.agencyId,
      leadId: job.leadId,
      businessPhoneNumberId: conv.businessPhoneNumberId as string,
      customerWaId: to,
      customerName: (conv.customerName as string | null) ?? null,
      sentByUserId,
      wamid: sent.wamid,
      text: message,
    })
    messageId = res.messageId
    // Tag the outbound message as an auto-response (persist takes no metadata arg).
    await db('inbox_messages').where({ id: messageId }).update({
      metadata: db.raw(`metadata || ?::jsonb`, [JSON.stringify({ source: 'auto_response', reason: job.reason, phase: 1 })]),
    })
  } catch (err) {
    // Delivered at Meta but local persist failed — do NOT retry (would double-send).
    console.error('[auto-response] persist after send failed', { jobId: job.id, err: String(err) })
  }

  await completeAutoResponseJob(job.id, messageId)
  await track({
    agencyId: job.agencyId,
    userId: sentByUserId ?? null,
    event: 'auto_response_sent',
    props: { conversationId: job.conversationId, leadId: job.leadId, reason: job.reason },
  })
  return 'sent'
}

export async function runAutoResponseWorker(
  opts: { limit?: number; leaseMs?: number; workerId?: string } = {},
): Promise<{ claimed: number; sent: number; skipped: number; failed: number }> {
  const limit = opts.limit ?? 5
  const leaseMs = opts.leaseMs ?? DEFAULT_LEASE_MS
  const workerId = opts.workerId ?? `arw-${process.pid}-${Date.now()}`

  await reclaimStaleAutoResponseJobs(leaseMs)
  const jobs = await claimAutoResponseJobs(workerId, limit)

  let sent = 0
  let skipped = 0
  let failed = 0
  for (const job of jobs) {
    try {
      const r = await processJob(job)
      if (r === 'sent') sent++
      else if (r === 'skipped') skipped++
      else failed++
    } catch (err) {
      await failAutoResponseJob(job.id, String(err))
      failed++
    }
  }
  return { claimed: jobs.length, sent, skipped, failed }
}
