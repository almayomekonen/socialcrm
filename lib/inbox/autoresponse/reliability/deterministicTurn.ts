import { track } from '@/lib/analytics/track'
import { completeAutoResponseJob, type AutoResponseJob } from '@/db/autoResponseJobs'
import { recordTurn } from '@/db/conversationAiState'
import type { sendWhatsappText } from '@/lib/whatsapp/sendMessage'
import { isPositiveLeadId } from '../contactJob'
import { sendIreOutbound, type IreOutboundCtx } from '../ireSend'
import { scheduleNoResponseWarning } from '../processNoResponseJob'
import { waTrace } from '../waTrace'
import { OPENING_KIND, type DeterministicTurn } from './silence'

/**
 * Deliver a deterministic turn (opening or media acknowledgement) through the
 * ONE agent send path. No model call happens here or before it.
 *
 * `sendIreOutbound` is what keeps this honest: it runs the IRE send gate and
 * the human-presence guard (`assertAgentSendAllowed`) immediately before the
 * Graph call, persists with `source: 'auto_response'`, and reports ambiguous
 * failures. Nothing here bypasses or duplicates any of it.
 *
 * Afterwards it is an ordinary agent turn: counted (so the greeting can never be
 * sent twice), the job completed, and — for the opening, which asks a question —
 * the same no-response follow-up an AI question gets.
 */
export async function sendDeterministicTurn(args: {
  job: AutoResponseJob
  ctx: IreOutboundCtx & { conv: { id: number } }
  send: typeof sendWhatsappText
  turn: DeterministicTurn
  skip: (reason: string) => Promise<'skipped'>
}): Promise<'sent' | 'skipped' | 'failed'> {
  const { job, ctx, turn } = args
  const trace = { conversationId: ctx.conv.id, jobId: job.id, agencyId: job.agencyId, triggerSequence: job.triggerSequence }
  waTrace('DETERMINISTIC_TURN', trace, { kind: turn.kind, media: 'media' in turn ? turn.media : null })

  const r = await sendIreOutbound(job, ctx, args.send, turn.text, {
    source: 'auto_response',
    reason: job.reason,
    phase: 1,
    kind: turn.kind,
  })
  if (r.ok === false) {
    if (r.settled) return 'failed'
    return args.skip(r.reason)
  }

  await recordTurn(ctx.conv.id, {})
  await completeAutoResponseJob(job.id, r.messageId)
  if (turn.kind === OPENING_KIND && isPositiveLeadId(job.leadId)) {
    await scheduleNoResponseWarning({
      agencyId: job.agencyId,
      conversationId: ctx.conv.id,
      leadId: job.leadId,
      channel: job.channel,
      triggerSequence: r.sequence,
    })
  }
  await track({
    agencyId: job.agencyId,
    event: 'auto_response_sent',
    props: { conversationId: ctx.conv.id, reason: `deterministic_${turn.kind}` },
  })
  return 'sent'
}
