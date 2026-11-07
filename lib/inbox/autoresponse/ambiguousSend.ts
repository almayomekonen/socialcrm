import { parkAmbiguousAutoResponseJob, SEND_OUTCOME_UNKNOWN } from '@/db/autoResponseJobs'
import { getOrCreateAiState, markEscalated } from '@/db/conversationAiState'
import { track } from '@/lib/analytics/track'
import { isHumanOwned, isNeverResumable } from './agentOwnership'

/**
 * An automated reply whose send outcome is UNKNOWN (timeout, dropped connection,
 * no message id): the customer may already have it. Resending would put a second
 * copy on their phone — or, for an AI turn, a second, different reply.
 *
 *   1. The job ends terminally (`skipped` / `send_outcome_unknown`) FIRST, so no
 *      retry, reclaim or later reset can run it again (failAutoResponseJob only
 *      touches a job that is still running).
 *   2. The conversation goes to a person through the existing handoff state
 *      (`escalated`): automation stops on it, and the notifications tick sends
 *      the rep the existing `lead.handoff` notification. A conversation a person
 *      already owns, or one that is opted out or closed, is left exactly as it
 *      is (the opt-out state is never rewritten here).
 *
 * Nothing is written to the thread: we do not know whether the message arrived,
 * and a row would claim that it did.
 */
export async function parkAmbiguousSend(
  job: { id: number; agencyId: number; conversationId: number; leadId: number | null },
  detail: string,
): Promise<void> {
  const parked = await parkAmbiguousAutoResponseJob(job.id, detail)
  try {
    const state = await getOrCreateAiState(job.conversationId, job.agencyId)
    if (!isHumanOwned(state.aiState) && !isNeverResumable(state.aiState)) {
      await markEscalated(job.conversationId, SEND_OUTCOME_UNKNOWN)
    }
  } catch (err) {
    // The job is already terminal; only the handoff is missing. Never retried.
    console.error('[IRE] ambiguous send: handoff failed', { jobId: job.id, name: (err as Error)?.name ?? null })
  }
  console.warn('[IRE] send outcome unknown; not retried, handed to a person', { jobId: job.id, conversationId: job.conversationId, parked })
  await track({
    agencyId: job.agencyId,
    event: 'auto_response_skipped',
    props: { conversationId: job.conversationId, reason: SEND_OUTCOME_UNKNOWN },
  }).catch(() => undefined)
}
