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
import { isPositiveLeadId } from './contactJob'
import { LeaseLostError, fencedSend, keepJobLease } from './jobLease'
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
import { formatBusinessIdentityBlock, groundedFactsFor, loadBusinessIdentity } from './businessIdentity'
import { decideGreeting, withGreeting } from './greeting'
import { safeFallbackReply } from './safeFallback'
import { detectLang } from './qualify'
import { hasPriorOutbound } from '@/db/inboxMessages'
import { assertIreSendAllowed } from './ireSendGate'
import { assertAgentSendAllowed } from './agentSendGuard'
import { enqueueFollowUpTurnIfOwed } from './followUpTurn'
import { aiRepliesPausedForPlan } from './reliability/entitlement'
import { AI_NOT_ENTITLED } from './reliability/reasons'

const TERMINAL_STATUSES = ['closed', 'lost']
const DEFAULT_LEASE_MS = 60_000

export type WorkerDeps = {
  send: typeof sendWhatsappText
  generate: typeof generateAcknowledgement
  generateQualify: typeof generateQualifyTurn
}

export { withinQuietHours }

type Outcome = 'sent' | 'skipped' | 'failed' | 'deferred'

async function processJob(rawJob: AutoResponseJob, deps: WorkerDeps): Promise<Outcome> {
  const doSkip = async (reason: string): Promise<Outcome> => {
    await skipAutoResponseJob(rawJob.id, reason)
    await track({ agencyId: rawJob.agencyId, event: 'auto_response_skipped', props: { conversationId: rawJob.conversationId, reason } })
    return 'skipped'
  }

  const leadQuery = isPositiveLeadId(rawJob.leadId)
    ? db('clients').where({ id: rawJob.leadId }).first('id', 'userId', 'handlerId', 'status', 'firstName')
    : Promise.resolve(null)
  const [master, settings, conv, leadFromJob] = await Promise.all([
    getMasterEnabled(rawJob.agencyId),
    getChannelSettings(rawJob.agencyId, rawJob.channel),
    db('inbox_conversations')
      .where({ id: rawJob.conversationId, agencyId: rawJob.agencyId })
      .first('id', 'businessPhoneNumberId', 'customerWaId', 'customerName', 'lastMessageText', 'isPersonal', 'leadId'),
    leadQuery,
  ])
  if (!conv) return doSkip(rawJob.reason === 'no_response_warning' || rawJob.reason === 'no_response_close' ? 'conversation_missing' : 'conversation_gone')
  if (conv.isPersonal === true) return doSkip('personal')

  let job = rawJob
  let lead = leadFromJob
  if (!isPositiveLeadId(rawJob.leadId)) {
    const convLeadId = conv.leadId != null && Number(conv.leadId) > 0 ? Number(conv.leadId) : null
    if (convLeadId != null) {
      lead = await db('clients').where({ id: convLeadId }).first('id', 'userId', 'handlerId', 'status', 'firstName')
      job = { ...rawJob, leadId: convLeadId }
    }
  }
  if (job.reason === 'no_response_warning' || job.reason === 'no_response_close') {
    if (!isPositiveLeadId(job.leadId) || !lead) return doSkip('contact_no_response')
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
  if (isPositiveLeadId(job.leadId) && !lead) return doSkip('lead_gone')
  if (lead?.status && TERMINAL_STATUSES.includes(lead.status)) return doSkip('lead_terminal')
  // No model may be called for an agency whose plan does not include the AI
  // reply (reliability rollout). Skipped, not failed: retrying cannot succeed,
  // and a dead job is exactly the silent loss this prevents.
  if (await aiRepliesPausedForPlan(job.agencyId, settings)) return doSkip(AI_NOT_ENTITLED)

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
          id: isPositiveLeadId(job.leadId) ? Number(lead?.id) : null,
          userId: (lead?.userId as number | null) ?? null,
          handlerId: (lead?.handlerId as number | null) ?? null,
          status: (lead?.status as string | null) ?? null,
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
  const lastCustomerMessage = (conv.lastMessageText as string | null) ?? ''
  const lang = detectLang(lastCustomerMessage)
  let message: string | null = null

  if (replyMode === 'fixed') {
    // A fixed reply is the owner's own words, sent verbatim. It is never
    // prefixed with a greeting: whatever welcome they want is already in it.
    const body = (settings?.fixedBody ?? '').trim()
    if (!body) return doSkip('fixed_body_empty')
    message = renderFixedReply(body, {
      firstName: (lead?.firstName as string | null) ?? null,
      customerName: (conv.customerName as string | null) ?? null,
    }).trim()
    if (!message) return doSkip('fixed_body_empty')
  } else {
    const identity = await loadBusinessIdentity(job.agencyId, job.channel)
    const businessIdentityBlock = formatBusinessIdentityBlock(identity)
    const priorOutbound = await hasPriorOutbound(job.conversationId)
    const greeting = decideGreeting({
      hasPriorOutbound: priorOutbound,
      businessName: identity.name,
      lang,
      aiState: null,
    })
    const greetingLine = greeting.greet ? greeting.line : null
    waTrace('GREETING_DECISION', { conversationId: job.conversationId, jobId: job.id, agencyId: job.agencyId }, {
      greet: greeting.greet,
      reason: 'reason' in greeting ? greeting.reason : null,
      hasBusinessName: Boolean(identity.name),
      priorOutbound,
      lang,
      mode: 'acknowledge',
    })

    for (let attempt = 0; attempt < 2 && !message; attempt++) {
      const gen = await deps.generate({
        agencyId: job.agencyId,
        customerName: (conv.customerName as string | null) ?? null,
        lastCustomerMessage,
        guidance: settings?.guidance ?? null,
        businessIdentityBlock,
        greetingLine,
        lang,
      })
      if (gen.ok === false) {
        if (isRetryableIreGenerationFailure(gen.skipReason)) {
          await failAutoResponseJob(job.id, gen.skipReason)
          return 'failed'
        }
        return doSkip(gen.skipReason)
      }
      if (
        validateAutoResponse(gen.message, {
          greetingTurn: Boolean(greetingLine),
          groundedFacts: groundedFactsFor(identity),
        }).ok
      ) {
        message = gen.message
      }
    }

    // RECOVERY, not silence. Two failed generations used to end the turn with
    // skipReason 'validation_failed' and the customer received nothing at all —
    // the worst available outcome, because they assume they were ignored and the
    // owner never learns it happened. A short honest holding message keeps the
    // conversation alive for a human. It still passes every gate below: the
    // send-eligibility re-check, the personal/tenant gate, and the human-presence
    // boundary all run after this point, unchanged.
    if (!message) {
      message = safeFallbackReply('acknowledgement', lang, greetingLine)
      console.warn(`[IRE] validation_failed_recovered conv=${job.conversationId} job=${job.id}`)
      await track({
        agencyId: job.agencyId,
        event: 'auto_response_recovered',
        props: { conversationId: job.conversationId, reason: 'validation_failed' },
      })
    }
  }
  console.log(`[IRE] generated conv=${job.conversationId} mode=${replyMode} len=${message.length}`)

  const gate = await assertIreSendAllowed(job.agencyId, job.conversationId)
  if (gate.ok === false) return doSkip(gate.reason)

  // ── HUMAN PRESENCE (second of two send guards) ─────────────────────────────
  // Acknowledge mode does not route through sendIreOutbound, so the boundary is
  // enforced explicitly here — same pair of guards, same order, same last moment.
  const presence = await assertAgentSendAllowed({
    conversationId: job.conversationId,
    turnStartedAt: job.createdAt,
    trace: {
      conversationId: job.conversationId,
      jobId: job.id,
      agencyId: job.agencyId,
      triggerSequence: job.triggerSequence,
    },
  })
  if (presence.authorized === false) return doSkip(presence.reason)

  const connection = await db('whatsapp_connections')
    .where({ phone_number_id: conv.businessPhoneNumberId, agency_id: job.agencyId })
    .first('phone_number_id', 'access_token', 'user_id')
  if (!connection) return doSkip('no_connection')
  const to = conv.customerWaId as string | null
  if (!to) return doSkip('no_recipient')

  const sentByUserId = (lead?.userId as number | null) ?? (lead?.handlerId as number | null) ?? connection.user_id
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
  // Renew EVERY claimed lease from the moment of the claim: jobs run one after
  // another, so the last one would otherwise expire while the first ones run.
  const leases = new Map(jobs.map((j) => [j.id, keepJobLease(j.id, workerId, leaseMs)]))

  let sent = 0
  let skipped = 0
  let failed = 0
  for (const job of jobs) {
    const lease = leases.get(job.id)!
    let leaseLost = false
    const jobDeps: WorkerDeps = { ...deps, send: fencedSend(deps.send, job.id, workerId) }
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
      const r = await processJob(job, jobDeps)
      outcome = r
      if (r === 'sent') sent++
      else if (r === 'skipped') skipped++
      else if (r === 'failed') failed++
    } catch (err) {
      if (err instanceof LeaseLostError) {
        // Another worker owns this job now; it decides the outcome. Nothing was sent.
        leaseLost = true
        console.warn('[IRE] lease lost before send; not sending', { jobId: job.id, conversationId: job.conversationId })
      } else {
        await failAutoResponseJob(job.id, String(err), workerId)
      }
      failed++
    } finally {
      lease.stop()
      // A lost job belongs to its new owner, follow-up turn included.
      if (!leaseLost) {
      try {
        const fin = await db('auto_response_jobs')
          .where({ id: job.id })
          .first('status', 'skipReason', 'lastError', 'sentMessageId')

        // ── Close the loop on a message that landed mid-turn ────────────────
        // The worker read its transcript once, at the start. Anything the
        // customer sent after that was refused by the in-flight unique index and
        // is covered by no job at all. Check now, while we know exactly which
        // sequence this job covered, and enqueue one more turn if a newer
        // inbound is waiting. See followUpTurn.ts for why this terminates.
        //
        // Wrapped with the trace write: a failure here must never change the
        // outcome of the job that just completed.
        let followUp: { jobId: number | null; decision: unknown } | null = null
        try {
          followUp = await db.transaction((trx) =>
            enqueueFollowUpTurnIfOwed(
              trx,
              {
                agencyId: job.agencyId,
                conversationId: job.conversationId,
                leadId: job.leadId,
                channel: job.channel,
                reason: job.reason,
                triggerSequence: job.triggerSequence,
              },
              { outcome, skipReason: (fin?.skipReason as string | null) ?? null },
            ),
          )
        } catch (followUpErr) {
          console.error('[IRE] follow-up enqueue failed', {
            conversationId: job.conversationId,
            reason: (followUpErr as Error)?.message,
          })
        }

        waTrace(
          'JOB_FINISHED',
          { ...traceCtx, messageId: (fin?.sentMessageId as number | null) ?? null },
          {
            outcome,
            finalStatus: fin?.status ?? null,
            skipReason: fin?.skipReason ?? null,
            lastError: fin?.lastError ?? null,
            durationMs: Date.now() - startedAt,
            followUpJobId: followUp?.jobId ?? null,
            followUpDecision: followUp?.decision ?? null,
          },
        )
      } catch {
        // logging only
      }
      }
    }
  }
  for (const l of leases.values()) l.stop()
  return { claimed: jobs.length, sent, skipped, failed }
}
