import type { Knex } from 'knex'
import { enqueueAutoResponse, skipPendingNoResponseJobs, type AutoResponseReason } from '@/db/autoResponseJobs'
import { aiRepliesPausedForPlan } from './reliability/entitlement'
import { AI_NOT_ENTITLED, OPT_OUT_COMMAND } from './reliability/reasons'
import { classifyOptOutCommand } from '@/lib/whatsapp/optOut/command'

export type UnansweredInbound = {
  id: number
  sequence: number
}

export type LatestMessage = {
  id: number
  direction: string
  sequence: number
}

/**
 * Latest message wins. An inbound with no later outbound is unanswered.
 * Multiple unanswered inbounds collapse to the latest inbound only.
 */
export function unansweredInboundFromLatest(last: LatestMessage | null | undefined): UnansweredInbound | null {
  if (!last) return null
  if (last.direction !== 'inbound') return null
  const sequence = Number(last.sequence)
  const id = Number(last.id)
  if (!Number.isFinite(id) || id <= 0) return null
  if (!Number.isFinite(sequence) || sequence < 0) return null
  return { id, sequence }
}

export async function findLatestUnansweredInbound(
  trx: Knex.Transaction,
  conversationId: number,
): Promise<UnansweredInbound | null> {
  const last = await trx('inbox_messages')
    .where({ conversationId })
    .orderBy([
      { column: 'sequence', order: 'desc' },
      { column: 'id', order: 'desc' },
    ])
    .first('id', 'direction', 'sequence')
  return unansweredInboundFromLatest(last as LatestMessage | undefined)
}

/**
 * Is the triggering customer message a typed opt-out command? Same classifier
 * and same "typed text only" rule as the recorder (lib/whatsapp/optOut/recordInbound.ts).
 * Shared by the webhook ingest and by "promote to lead", which re-enqueues for
 * the latest unanswered inbound.
 */
async function triggerIsOptOutCommand(trx: Knex.Transaction, conversationId: number, sequence: number): Promise<boolean> {
  const msg = (await trx('inbox_messages')
    .where({ conversationId, sequence, direction: 'inbound' })
    .orderBy('id', 'desc')
    .first('type', 'text')) as { type: string | null; text: string | null } | undefined
  return msg?.type === 'text' && classifyOptOutCommand(msg.text ?? '') === 'opt_out'
}

export type EnqueueInboundAutoResponseResult = {
  jobId: number | null
  reason: AutoResponseReason
  delaySeconds: number
  /** Why no job was created on purpose (not the ordinary duplicate/guard refusals). */
  suppressed?: typeof AI_NOT_ENTITLED | typeof OPT_OUT_COMMAND
}

/**
 * Same IRE enqueue used by WhatsApp inbound ingest: settings → delaySeconds →
 * qualify_turn vs first_contact → enqueueAutoResponse (existing guards).
 */
export async function enqueueInboundAutoResponse(
  trx: Knex.Transaction,
  args: {
    agencyId: number
    conversationId: number
    leadId: number | null
    triggerSequence: number
  },
): Promise<EnqueueInboundAutoResponseResult> {
  const arSettings = await trx('auto_response_settings')
    .where({ agencyId: args.agencyId, channel: 'whatsapp' })
    .first('mode', 'delaySeconds', 'responder', 'replyMode')
  const delayRaw = Number(arSettings?.delaySeconds ?? 0)
  const delaySeconds = Number.isFinite(delayRaw) ? Math.min(Math.max(Math.floor(delayRaw), 0), 3600) : 0
  /**
   * The questionnaire needs a per-turn job, like qualify, rather than the
   * once-per-conversation `first_contact`. The reason is a label, for
   * observability and for the follow-up rule; WHICH WORKER gets the job is
   * decided later, at claim time, from the configuration as it stands then
   * (db/questionnaireJobs.ts).
   */
  const reason: AutoResponseReason =
    arSettings?.responder === 'questionnaire'
      ? 'questionnaire_turn'
      : arSettings?.mode === 'qualify'
        ? 'qualify_turn'
        : 'first_contact'
  await skipPendingNoResponseJobs(trx, args.conversationId)
  // The customer's message is an opt-out command: it is recorded and kept in
  // the conversation, but nothing answers it (no job, so no AI generation).
  if (await triggerIsOptOutCommand(trx, args.conversationId, args.triggerSequence)) {
    return { jobId: null, reason, delaySeconds, suppressed: OPT_OUT_COMMAND }
  }
  // A job the router is certain to refuse is not created (reliability rollout).
  // The message itself is already persisted and notified by the caller.
  if (await aiRepliesPausedForPlan(args.agencyId, arSettings)) {
    return { jobId: null, reason, delaySeconds, suppressed: AI_NOT_ENTITLED }
  }
  const jobId = await enqueueAutoResponse(trx, {
    agencyId: args.agencyId,
    conversationId: args.conversationId,
    leadId: args.leadId,
    channel: 'whatsapp',
    triggerSequence: args.triggerSequence,
    reason,
    delaySeconds,
  })
  return { jobId, reason, delaySeconds }
}
