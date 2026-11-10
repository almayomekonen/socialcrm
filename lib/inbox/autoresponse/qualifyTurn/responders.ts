/**
 * Greeting resolution and the courtesy reply of a qualify turn.
 *
 * Part of the qualify turn (../qualifyWorker.ts), moved out unchanged so the
 * orchestrator stays reviewable (architecture-rules §1, §5). Behaviour-preserving:
 * the statements are the original ones, in the original order.
 */
import { db } from '@/config/db'
import { track } from '@/lib/analytics/track'
import { completeAutoResponseJob, skipPendingNoResponseJobs } from '@/db/autoResponseJobs'
import { markClosed } from '@/db/conversationAiState'
import { decidePreGeneration } from '../stateMachine'
import { waTrace } from '../waTrace'
import { loadBusinessIdentity } from '../businessIdentity'
import { decideGreeting } from '../greeting'
import { hasPriorOutbound } from '@/db/inboxMessages'
import { sendIreOutbound } from '../ireSend'
import { COURTESY_KIND, courtesyLine, decideCourtesyClose, isCourtesyMessage } from '../courtesyClose'
import type { Outcome, TurnBase, TurnFacts } from './types'

/** The lazily resolved greeting and the one-line courtesy reply, bound to this turn. */
export function turnResponders(t: TurnBase & TurnFacts) {
  const { job, ctx, deps, doSkip, recent, aiState, humanTookOver, lastInboundText, optOut, agentHasSpoken, outboundGate, lang } = t
  const { conv } = ctx
  // ── First greeting ────────────────────────────────────────────────────────
  // Decided deterministically here and handed to the model as a verbatim line.
  // The model is never asked to judge "is this the start of the conversation?"
  // from a transcript — that is how a greeting lands on turn five and goes
  // missing on turn one.
  //
  // Resolved lazily and memoized, because most claimed jobs end in a skip
  // (no_pending_inbound, quiet_hours, human_active…) and must not pay for two
  // extra queries to answer a question no send will ask.
  //
  // `countPriorOutbound` is a durable COUNT, not a scan of `recent`: that array
  // is capped at MAX_TRANSCRIPT, so past the cap an early greeting would fall
  // out of the window and the same customer would be greeted twice.
  let greetingResolved: { identity: Awaited<ReturnType<typeof loadBusinessIdentity>>; line: string | null } | null = null
  const resolveGreeting = async () => {
    if (greetingResolved) return greetingResolved
    const identity = await loadBusinessIdentity(job.agencyId, job.channel)
    const priorOutbound = await hasPriorOutbound(conv.id)
    const decision = decideGreeting({
      hasPriorOutbound: priorOutbound,
      aiTurnCount: aiState.aiTurnCount,
      businessName: identity.name,
      lang,
      aiState: aiState.aiState,
    })
    waTrace(
      'GREETING_DECISION',
      { conversationId: conv.id, jobId: job.id, agencyId: job.agencyId, triggerSequence: job.triggerSequence },
      {
        greet: decision.greet,
        reason: 'reason' in decision ? decision.reason : null,
        hasBusinessName: Boolean(identity.name),
        priorOutbound,
        lang,
      },
    )
    greetingResolved = { identity, line: decision.greet ? decision.line : null }
    return greetingResolved
  }

  /**
   * One warm line for "thank you", and nothing else.
   *
   * Called from TWO places, which is the whole point: the silent-close path, and
   * — before the pre-generation gate — a conversation already handed to a human.
   * `escalated` is a hard skip in decidePreGeneration, so a customer who thanks
   * the business after a real handoff would otherwise never reach the courtesy
   * branch at all. That is exactly the case the original transcript could not
   * exercise, because it never entered handoff state.
   *
   * Never changes ownership and never records a turn. On an escalated
   * conversation the state is left escalated: the request is still waiting for a
   * person, and a pleasantry does not change that.
   */
  const attemptCourtesy = async (opts: { closeAfter: string | null }): Promise<Outcome | null> => {
    const decision = decideCourtesyClose({
      inboundText: lastInboundText,
      agentHasSpoken,
      humanTookOver,
      optOut,
      alreadySentCourtesy: recent.some((m) => m.direction === 'outbound' && isCourtesyMessage(m.metadata)),
    })
    waTrace(
      'COURTESY_CLOSE',
      { conversationId: conv.id, jobId: job.id, agencyId: job.agencyId, triggerSequence: job.triggerSequence },
      { send: decision.send, reason: 'reason' in decision ? decision.reason : null, aiState: aiState.aiState },
    )
    if (!decision.send) return null
    const gate = outboundGate()
    if (gate.allowed === false) return doSkip(gate.reason)
    const r = await sendIreOutbound(job, ctx, deps.send, courtesyLine(lang, conv.id), {
      source: 'auto_response',
      reason: job.reason,
      phase: 2,
      kind: COURTESY_KIND,
    })
    if (r.ok === false) {
      if (r.settled) return 'failed'
      return doSkip(r.reason)
    }
    await db.transaction((trx) => skipPendingNoResponseJobs(trx, conv.id))
    // Only the ordinary close path closes. An escalated conversation stays
    // escalated — a person still owns it.
    if (opts.closeAfter) await markClosed(conv.id, opts.closeAfter)
    await completeAutoResponseJob(job.id, r.messageId)
    await track({
      agencyId: job.agencyId,
      event: 'auto_response_sent',
      props: { conversationId: conv.id, reason: `courtesy_${opts.closeAfter ?? aiState.aiState}` },
    })
    return 'sent'
  }

  return { resolveGreeting, attemptCourtesy }
}
