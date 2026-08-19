import { db } from '@/config/db'
import { sendWhatsappText, formatWhatsappSendFailure } from '@/lib/whatsapp/sendMessage'
import { persistOutboundWhatsapp } from '@/lib/inbox/persistOutboundWhatsapp'
import { applyIreWhatsappSendFailure } from '@/lib/inbox/onWhatsappSendFailure'
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
import { generateQualifyTurn } from './qualify'
import { processQualifyJob } from './qualifyWorker'
import { processNoResponseJob } from './processNoResponseJob'
import { withinQuietHours } from './noResponseClose'
import { isRetryableIreGenerationFailure } from './retryableGeneration'
import { validateAutoResponse } from './validate'
import { renderFixedReply } from './renderFixedReply'
import { waTrace } from './waTrace'
import { resolveWhatsappAccessToken } from '@/lib/whatsapp/connectionToken'
import { formatBusinessIdentityBlock, loadBusinessIdentity } from './businessIdentity'

const TERMINAL_STATUSES = ['closed', 'lost']
const DEFAULT_LEASE_MS = 60_000

export type WorkerDeps = {
  send: typeof sendWhatsappText
  generate: typeof generateAcknowledgement
  generateQualify: typeof generateQualifyTurn
}

export { withinQuietHours }

type Outcome = 'sent' | 'skipped' | 'failed' | 'deferred'

async function processJob(job: AutoResponseJob, deps: WorkerDeps): Promise<Outcome> {
  const doSkip = async (reason: string): Promise<Outcome> => {
    await skipAutoResponseJob(job.id, reason)
    await track({ agencyId: job.agencyId, event: 'auto_response_skipped', props: { conversationId: job.conversationId, reason } })
    return 'skipped'
  }

  const [master, settings, conv, lead] = await Promise.all([
    getMasterEnabled(job.agencyId),
    getChannelSettings(job.agencyId, job.channel),
    db('inbox_conversations')
      .where({ id: job.conversationId })
      .first('id', 'businessPhoneNumberId', 'customerWaId', 'customerName', 'lastMessageText'),
    db('clients').where({ id: job.leadId }).first('id', 'userId', 'handlerId', 'status', 'firstName'),
  ])
  if (!conv) return doSkip(job.reason === 'no_response_warning' || job.reason === 'no_response_close' ? 'conversation_missing' : 'conversation_gone')
  if (!lead) return doSkip(job.reason === 'no_response_warning' || job.reason === 'no_response_close' ? 'conversation_missing' : 'lead_gone')
  if (lead.status && TERMINAL_STATUSES.includes(lead.status)) return doSkip('lead_terminal')

  if (job.reason === 'no_response_warning' || job.reason === 'no_response_close') {
    return processNoResponseJob(
      job,
      {
        settings: settings ?? undefined,
        conv: {
          id: Number(conv.id),
          businessPhoneNumberId: String(conv.businessPhoneNumberId),
          customerWaId: (conv.customerWaId as string | null) ?? null,
          customerName: (conv.customerName as string | null) ?? null,
        },
        lead: {
          userId: (lead.userId as number | null) ?? null,
          handlerId: (lead.handlerId as number | null) ?? null,
        },
      },
      { send: deps.send },
    )
  }

  // Qualify mode (opt-in per agency) branches to its own processor; acknowledge
  // mode (everything below) is unchanged.
  if (settings?.mode === 'qualify') {
    return processQualifyJob(
      job,
      {
        master,
        settings,
        conv: {
          id: Number(conv.id),
          businessPhoneNumberId: String(conv.businessPhoneNumberId),
          customerWaId: (conv.customerWaId as string | null) ?? null,
          customerName: (conv.customerName as string | null) ?? null,
        },
        lead: {
          id: Number(lead.id),
          userId: (lead.userId as number | null) ?? null,
          handlerId: (lead.handlerId as number | null) ?? null,
          status: (lead.status as string | null) ?? null,
        },
      },
      { send: deps.send, generateQualify: deps.generateQualify },
    )
  }

  const [outboundExists, humanReplyExists, priorAuto, sentToday] = await Promise.all([
    db('inbox_messages').where({ conversationId: job.conversationId, direction: 'outbound' }).first('id'),
    db('inbox_messages')
      .where({ conversationId: job.conversationId, direction: 'outbound' })
      .whereNotNull('sentByUserId')
      .first('id'),
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

  const replyMode = settings?.replyMode ?? 'ai'
  let message: string | null = null

  if (replyMode === 'fixed') {
    const body = (settings?.fixedBody ?? '').trim()
    if (!body) return doSkip('fixed_body_empty')
    message = renderFixedReply(body, {
      firstName: (lead.firstName as string | null) ?? null,
      customerName: (conv.customerName as string | null) ?? null,
    }).trim()
    if (!message) return doSkip('fixed_body_empty')
  } else {
    const identity = await loadBusinessIdentity(job.agencyId, job.channel)
    const businessIdentityBlock = formatBusinessIdentityBlock(identity)
    for (let attempt = 0; attempt < 2 && !message; attempt++) {
      const gen = await deps.generate({
        agencyId: job.agencyId,
        customerName: (conv.customerName as string | null) ?? null,
        lastCustomerMessage: (conv.lastMessageText as string | null) ?? '',
        guidance: settings?.guidance ?? null,
        businessIdentityBlock,
      })
      if (gen.ok === false) {
        if (isRetryableIreGenerationFailure(gen.skipReason)) {
          await failAutoResponseJob(job.id, gen.skipReason)
          return 'failed'
        }
        return doSkip(gen.skipReason)
      }
      if (validateAutoResponse(gen.message).ok) message = gen.message
    }
    if (!message) return doSkip('validation_failed')
  }
  console.log(`[IRE] generated conv=${job.conversationId} mode=${replyMode} len=${message.length}`)

  const connection = await db('whatsapp_connections')
    .where({ phone_number_id: conv.businessPhoneNumberId, agency_id: job.agencyId })
    .first('phone_number_id', 'access_token', 'user_id')
  if (!connection) return doSkip('no_connection')
  const to = conv.customerWaId as string | null
  if (!to) return doSkip('no_recipient')

  const sentByUserId = (lead.userId as number | null) ?? (lead.handlerId as number | null) ?? connection.user_id
  const sent = await deps.send({
    phoneNumberId: conv.businessPhoneNumberId as string,
    accessToken: resolveWhatsappAccessToken(connection.access_token),
    to,
    body: message,
    trace: { conversationId: job.conversationId, jobId: job.id, agencyId: job.agencyId, triggerSequence: job.triggerSequence },
  })
  if (sent.ok === false) {
    const detail = formatWhatsappSendFailure(sent)
    console.error(`[IRE] send failed conv=${job.conversationId} job=${job.id} ${detail}`)
    await applyIreWhatsappSendFailure(job, sent, {
      businessPhoneNumberId: conv.businessPhoneNumberId as string,
      customerWaId: to,
      customerName: (conv.customerName as string | null) ?? null,
      sentByUserId,
      text: message,
    })
    return 'failed'
  }
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
    await db('inbox_messages')
      .where({ id: messageId })
      .update({
        metadata: db.raw(`metadata || ?::jsonb`, [JSON.stringify({ source: 'auto_response', reason: job.reason, phase: 1 })]),
      })
  } catch (err) {
    console.error('[auto-response] persist after send failed', { jobId: job.id, err: String(err) })
  }

  await completeAutoResponseJob(job.id, messageId)
  console.log(
    `[IRE] sent conv=${job.conversationId} job=${job.id} msg=${messageId ?? 'none'} ms=${Date.now() - new Date(job.createdAt).getTime()}`,
  )
  await track({
    agencyId: job.agencyId,
    userId: sentByUserId ?? null,
    event: 'auto_response_sent',
    props: { conversationId: job.conversationId, leadId: job.leadId, reason: job.reason, replyMode },
  })
  return 'sent'
}

export async function runAutoResponseWorker(
  opts: { limit?: number; leaseMs?: number; workerId?: string; deps?: Partial<WorkerDeps> } = {},
): Promise<{ claimed: number; sent: number; skipped: number; failed: number }> {
  const limit = opts.limit ?? 5
  const leaseMs = opts.leaseMs ?? DEFAULT_LEASE_MS
  const workerId = opts.workerId ?? `arw-${process.pid}-${Date.now()}`
  const deps: WorkerDeps = {
    send: opts.deps?.send ?? sendWhatsappText,
    generate: opts.deps?.generate ?? generateAcknowledgement,
    generateQualify: opts.deps?.generateQualify ?? generateQualifyTurn,
  }

  await reclaimStaleAutoResponseJobs(leaseMs)
  const jobs = await claimAutoResponseJobs(workerId, limit)
  if (jobs.length) console.log(`[IRE] worker start id=${workerId} claimed=${jobs.length}`)

  let sent = 0
  let skipped = 0
  let failed = 0
  for (const job of jobs) {
    const startedAt = Date.now()
    const traceCtx = {
      conversationId: job.conversationId,
      jobId: job.id,
      agencyId: job.agencyId,
      triggerSequence: job.triggerSequence,
    }
    waTrace('WORKER_STARTED', traceCtx, { jobId: job.id, attempt: job.attempts, maxAttempts: job.maxAttempts })
    let outcome: Outcome | 'error' = 'error'
    try {
      const r = await processJob(job, deps)
      outcome = r
      if (r === 'sent') sent++
      else if (r === 'skipped') skipped++
      else if (r === 'failed') failed++
    } catch (err) {
      await failAutoResponseJob(job.id, String(err))
      failed++
    } finally {
      try {
        const fin = await db('auto_response_jobs')
          .where({ id: job.id })
          .first('status', 'skipReason', 'lastError', 'sentMessageId')
        waTrace(
          'JOB_FINISHED',
          { ...traceCtx, messageId: (fin?.sentMessageId as number | null) ?? null },
          {
            outcome,
            finalStatus: fin?.status ?? null,
            skipReason: fin?.skipReason ?? null,
            lastError: fin?.lastError ?? null,
            durationMs: Date.now() - startedAt,
          },
        )
      } catch {
        // logging only
      }
    }
  }
  return { claimed: jobs.length, sent, skipped, failed }
}
