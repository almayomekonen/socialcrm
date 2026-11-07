import {
  failAutoResponseJob,
  parkAmbiguousAutoResponseJob,
  reclaimStaleAutoResponseJobs,
  SEND_OUTCOME_UNKNOWN,
  type ParkedAutoResponseJob,
} from '@/db/autoResponseJobs'
import { getOrCreateAiState, markEscalated } from '@/db/conversationAiState'
import { track } from '@/lib/analytics/track'
import { isHumanOwned, isNeverResumable } from './agentOwnership'

/**
 * An automated reply whose send outcome is UNKNOWN (timeout, dropped connection,
 * no message id, or a send that started and was never seen to finish): the
 * customer may already have it. Resending would put a second copy on their
 * phone — or, for an AI turn, a second, different reply.
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
export async function parkAmbiguousSend(job: ParkedAutoResponseJob, detail: string): Promise<void> {
  const parked = await parkAmbiguousAutoResponseJob(job.id, detail)
  await handToPerson(job, { parked, via: 'send_result' })
}

/** Step 2 above, for a job that is already terminal. Never throws. */
async function handToPerson(job: ParkedAutoResponseJob, why: Record<string, unknown>): Promise<void> {
  try {
    const state = await getOrCreateAiState(job.conversationId, job.agencyId)
    if (!isHumanOwned(state.aiState) && !isNeverResumable(state.aiState)) {
      await markEscalated(job.conversationId, SEND_OUTCOME_UNKNOWN)
    }
  } catch (err) {
    // The job is already terminal; only the handoff is missing. Never retried.
    console.error('[IRE] ambiguous send: handoff failed', { jobId: job.id, name: (err as Error)?.name ?? null })
  }
  console.warn('[IRE] send outcome unknown; not retried, handed to a person', { jobId: job.id, conversationId: job.conversationId, ...why })
  await track({
    agencyId: job.agencyId,
    event: 'auto_response_skipped',
    props: { conversationId: job.conversationId, reason: SEND_OUTCOME_UNKNOWN },
  }).catch(() => undefined)
}

/**
 * The lease reclaim, for both workers: a job whose send had started is parked by
 * the reclaim itself; its conversation is handed to a person here.
 */
export async function reclaimStaleAutoResponseJobsAndHandOff(leaseMs: number): Promise<number> {
  return reclaimStaleAutoResponseJobs(leaseMs, async (parked) => {
    for (const job of parked) await handToPerson(job, { parked: true, via: 'lease_expired_after_send_started' })
  })
}

/**
 * failAutoResponseJob, plus the handoff when the job's send had started (e.g.
 * the send succeeded and persisting it threw): parked, never retried.
 */
export async function failOrParkAutoResponseJob(id: number, error: string, ownerWorkerId?: string): Promise<void> {
  const parked = await failAutoResponseJob(id, error, ownerWorkerId)
  if (parked) await handToPerson(parked, { parked: true, via: 'failure_after_send_started' })
}
