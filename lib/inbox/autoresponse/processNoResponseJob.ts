/**
 * Executes no_response_warning / no_response_close jobs. Restart-safe: the cron
 * claims by notBefore; this handler re-reads the conversation before any send.
 * Never calls OpenAI or qualify generation.
 */
import { db } from '@/config/db'
import { track } from '@/lib/analytics/track'
import {
  completeAutoResponseJob,
  deferAutoResponseJob,
  enqueueAutoResponse,
  skipAutoResponseJob,
  type AutoResponseJob,
} from '@/db/autoResponseJobs'
import { isPositiveLeadId } from './contactJob'
import { getOrCreateAiState, markClosed } from '@/db/conversationAiState'
import type { AutoResponseSettings } from '@/db/autoResponseSettings'
import { sendWhatsappText } from '@/lib/whatsapp/sendMessage'
import { sendIreOutbound, type IreOutboundCtx } from './ireSend'
import {
  decideNoResponseJob,
  isNoResponseCloseMessage,
  isNoResponseWarningMessage,
  metadataKind,
  nextAllowedAfterQuietHours,
  NO_RESPONSE_CLOSE_DELAY_SECONDS,
  NO_RESPONSE_CLOSED_STATE_REASON,
  NO_RESPONSE_CLOSED_TEXT,
  NO_RESPONSE_WARNING_DELAY_SECONDS,
  NO_RESPONSE_WARNING_TEXT,
  withinQuietHours,
  type NoResponseJobReason,
} from './noResponseClose'

type Outcome = 'sent' | 'skipped' | 'failed' | 'deferred'

const MAX_TRANSCRIPT = 80

type TranscriptRow = { direction: string; text?: string | null; sequence: number; metadata?: unknown }

export async function scheduleNoResponseWarning(args: {
  agencyId: number
  conversationId: number
  leadId: number
  channel: string
  triggerSequence: number | null | undefined
}): Promise<number | null> {
  const seq = Number(args.triggerSequence)
  if (!Number.isFinite(seq) || seq <= 0) return null
  return db.transaction((trx) =>
    enqueueAutoResponse(trx, {
      agencyId: args.agencyId,
      conversationId: args.conversationId,
      leadId: args.leadId,
      channel: args.channel,
      triggerSequence: seq,
      reason: 'no_response_warning',
      delaySeconds: NO_RESPONSE_WARNING_DELAY_SECONDS,
    }),
  )
}

export async function scheduleNoResponseClose(args: {
  agencyId: number
  conversationId: number
  leadId: number
  channel: string
  triggerSequence: number | null | undefined
}): Promise<number | null> {
  const seq = Number(args.triggerSequence)
  if (!Number.isFinite(seq) || seq <= 0) return null
  return db.transaction((trx) =>
    enqueueAutoResponse(trx, {
      agencyId: args.agencyId,
      conversationId: args.conversationId,
      leadId: args.leadId,
      channel: args.channel,
      triggerSequence: seq,
      reason: 'no_response_close',
      delaySeconds: NO_RESPONSE_CLOSE_DELAY_SECONDS,
    }),
  )
}

export type NoResponseJobCtx = IreOutboundCtx & {
  settings?: AutoResponseSettings
}

async function loadTranscript(conversationId: number): Promise<TranscriptRow[]> {
  const rows = await db('inbox_messages')
    .where({ conversationId })
    .orderBy('sequence', 'desc')
    .limit(MAX_TRANSCRIPT)
    .select('direction', 'text', 'sequence', 'metadata')
  return rows.slice().reverse() as TranscriptRow[]
}

function maxInboundSequenceOf(recent: TranscriptRow[]): number {
  return recent.reduce((max, m) => {
    if (m.direction !== 'inbound') return max
    const seq = Number(m.sequence)
    return Number.isFinite(seq) ? Math.max(max, seq) : max
  }, 0)
}

async function jobStatus(id: number): Promise<string | null> {
  const row = await db('auto_response_jobs').where({ id }).first('status')
  return (row?.status as string | undefined) ?? null
}

export async function processNoResponseJob(
  job: AutoResponseJob,
  ctx: NoResponseJobCtx,
  deps: { send: typeof sendWhatsappText },
): Promise<Outcome> {
  const phase = job.reason === 'no_response_close' ? 'close' : 'warning'
  const doSkip = async (reason: string): Promise<Outcome> => {
    await skipAutoResponseJob(job.id, reason)
    await track({
      agencyId: job.agencyId,
      event: 'auto_response_skipped',
      props: { conversationId: ctx.conv.id, reason, mode: 'no_response' },
    })
    return 'skipped'
  }

  if (!isPositiveLeadId(job.leadId)) return doSkip('contact_no_response')

  const recent = await loadTranscript(job.conversationId)
  const last = recent[recent.length - 1]
  const maxInboundSequence = maxInboundSequenceOf(recent)
  const aiRow = await getOrCreateAiState(job.conversationId, job.agencyId)
  const settings: AutoResponseSettings | undefined = ctx.settings
  const now = new Date()
  const lastText = String(last?.text ?? '')
  const lastKind = metadataKind(last?.metadata)
  const lastSequence = Number(last?.sequence) || 0
  const decision = decideNoResponseJob({
    phase,
    aiState: aiRow?.aiState ?? null,
    lastDirection: (last?.direction as string | null) ?? null,
    lastText,
    lastKind,
    lastSequence,
    maxInboundSequence,
    triggerSequence: job.triggerSequence,
    withinQuietHours: withinQuietHours(settings?.quietHours, now),
    conversationMissing: false,
  })

  if (decision.action === 'skip') {
    // Restart-safe: WhatsApp send already landed, then the process died before
    // complete/enqueue. Do not resend; finish the lifecycle from the transcript.
    // Close eligibility is always the original CONTINUE triggerSequence, never
    // the warning's own sequence.
    if (
      phase === 'warning' &&
      isNoResponseWarningMessage(lastText, lastKind) &&
      (decision.reason === 'duplicate_warning' || decision.reason === 'stale_trigger')
    ) {
      if (maxInboundSequence > job.triggerSequence) return doSkip('customer_replied')
      const completed = await completeAutoResponseJob(job.id, null)
      if (completed !== false && isPositiveLeadId(job.leadId)) {
        await scheduleNoResponseClose({
          agencyId: job.agencyId,
          conversationId: job.conversationId,
          leadId: job.leadId,
          channel: job.channel,
          triggerSequence: job.triggerSequence,
        })
      }
      return 'sent'
    }
    if (
      phase === 'close' &&
      isNoResponseCloseMessage(lastText, lastKind) &&
      (decision.reason === 'duplicate_close' || decision.reason === 'stale_trigger')
    ) {
      if (maxInboundSequence > job.triggerSequence) return doSkip('customer_replied')
      if (aiRow?.aiState !== 'closed') {
        await markClosed(job.conversationId, NO_RESPONSE_CLOSED_STATE_REASON)
      }
      await completeAutoResponseJob(job.id, null)
      return 'sent'
    }
    return doSkip(decision.reason)
  }
  if (decision.action === 'defer_quiet_hours') {
    const when = nextAllowedAfterQuietHours(settings?.quietHours, now)
    await deferAutoResponseJob(job.id, when)
    return 'deferred'
  }

  const preGraphRecent = await loadTranscript(job.conversationId)
  const preGraphInbound = maxInboundSequenceOf(preGraphRecent)
  const status = await jobStatus(job.id)
  if (status !== 'processing') return doSkip('inbound_superseded')
  if (preGraphInbound > job.triggerSequence) return doSkip('customer_replied')

  const kind: NoResponseJobReason = phase === 'close' ? 'no_response_close' : 'no_response_warning'
  const body = phase === 'close' ? NO_RESPONSE_CLOSED_TEXT : NO_RESPONSE_WARNING_TEXT
  const sent = await sendIreOutbound(job, ctx, deps.send, body, {
    source: 'auto_response',
    reason: job.reason,
    phase: 2,
    kind,
  })
  if (sent.ok === false) {
    if (sent.settled) return 'failed'
    return doSkip(sent.reason)
  }

  const afterRecent = await loadTranscript(job.conversationId)
  const afterInbound = maxInboundSequenceOf(afterRecent)
  if (afterInbound > job.triggerSequence) {
    await completeAutoResponseJob(job.id, sent.messageId)
    return 'sent'
  }

  if (phase === 'close') {
    await markClosed(job.conversationId, NO_RESPONSE_CLOSED_STATE_REASON)
  }
  const completed = await completeAutoResponseJob(job.id, sent.messageId)
  if (phase === 'warning' && completed !== false && isPositiveLeadId(job.leadId)) {
    await scheduleNoResponseClose({
      agencyId: job.agencyId,
      conversationId: job.conversationId,
      leadId: job.leadId,
      channel: job.channel,
      triggerSequence: job.triggerSequence,
    })
  }
  await track({
    agencyId: job.agencyId,
    event: 'auto_response_sent',
    props: { conversationId: ctx.conv.id, reason: job.reason },
  })
  return 'sent'
}
