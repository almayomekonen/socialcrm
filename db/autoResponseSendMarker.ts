import { db } from '@/config/db'

/** A job parked because its send had started: what the handoff needs. */
export type ParkedAutoResponseJob = { id: number; agencyId: number; conversationId: number; leadId: number | null }

export const parkedRow = (r: Record<string, unknown>): ParkedAutoResponseJob => ({
  id: Number(r.id),
  agencyId: Number(r.agencyId),
  conversationId: Number(r.conversationId),
  leadId: r.leadId == null ? null : Number(r.leadId),
})

/**
 * The durable "this job's WhatsApp send has started" marker
 * (`auto_response_jobs."sendStartedAt"`), written and cleared only by the job's
 * current lease owner.
 *
 * Set immediately before the provider request and committed before it is made,
 * so a worker that dies after Meta accepted the message — but before the outbound
 * row was saved — leaves proof behind. reclaimStaleAutoResponseJobs and
 * failAutoResponseJob then park the job instead of returning it to `pending`.
 * Cleared only when nothing reached Meta (a definite refusal, or a refusal
 * before the request), so that job keeps its ordinary retry.
 */

/**
 * Lease fence and marker in ONE statement: true only if `workerId` still owns
 * the running job, in which case the marker is now recorded. A stale worker
 * gets false, records nothing, and must not send.
 */
export async function markSendStarted(id: number, workerId: string): Promise<boolean> {
  const n = await db('auto_response_jobs')
    .where({ id, status: 'processing', lockedBy: workerId })
    .update({ sendStartedAt: db.fn.now(), updatedAt: db.fn.now() })
  return Number(n) > 0
}

/**
 * Nothing reached Meta: clear the marker so the job's normal retry applies.
 * Owner-checked like markSendStarted — false means another worker owns the job
 * now, and this worker must leave it alone.
 */
export async function clearSendStarted(id: number, workerId: string): Promise<boolean> {
  const n = await db('auto_response_jobs')
    .where({ id, status: 'processing', lockedBy: workerId })
    .update({ sendStartedAt: null, updatedAt: db.fn.now() })
  return Number(n) > 0
}
