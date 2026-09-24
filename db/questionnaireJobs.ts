/**
 * Which worker may claim a job.
 *
 * This is the routing boundary for the whole feature, and it is one SQL
 * predicate defined once. The AI worker's claim adds `NOT (…)`; the
 * questionnaire worker's claim adds the predicate itself. A job therefore
 * belongs to exactly one of them, decided at claim time from the CURRENT
 * configuration rather than from whatever was true when it was enqueued.
 *
 * Deciding it here, in the claim, rather than with a branch inside the worker,
 * is what lets `lib/inbox/autoresponse/worker.ts` stay untouched (it is frozen
 * by instruction) and gives a structural guarantee rather than a procedural
 * one: the module that imports the model generators never loads these rows, so
 * a questionnaire turn cannot reach an LLM even if someone later adds a new
 * branch to it.
 *
 * THREE WAYS A JOB IS QUESTIONNAIRE WORK:
 *   1. the business is configured for the questionnaire right now;
 *   2. the conversation has a live session — this is what keeps a conversation
 *      that is mid-questionnaire away from the agent when the business is
 *      switched back, including during a rollback;
 *   3. the job was enqueued as a questionnaire turn.
 * Any one of them is enough, and (2) deliberately outlives (1).
 */
import { db } from '@/config/db'
import type { AutoResponseJob, AutoResponseReason } from './autoResponseJobs'

/** Refers to the alias `j`. Both claims select `FROM auto_response_jobs j`. */
export const QUESTIONNAIRE_ROUTED_SQL = `(
  EXISTS (
    SELECT 1 FROM auto_response_settings s
     WHERE s."agencyId" = j."agencyId" AND s.channel = j.channel AND s.responder = 'questionnaire'
  )
  OR EXISTS (
    SELECT 1 FROM questionnaire_sessions q
     WHERE q."conversationId" = j."conversationId" AND q.status = 'active'
  )
  OR j.reason = 'questionnaire_turn'
)`

function parseLeadId(value: unknown): number | null {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Claim questionnaire jobs. Same mechanics as the AI worker's claim — SKIP
 * LOCKED, one atomic status change, attempts incremented — so a job can never
 * be claimed by both workers.
 */
export async function claimQuestionnaireJobs(workerId: string, limit: number): Promise<AutoResponseJob[]> {
  const res = await db.raw(
    `
    UPDATE auto_response_jobs t
       SET status = 'processing', "lockedAt" = now(), "lockedBy" = ?,
           attempts = attempts + 1, "updatedAt" = now()
     WHERE t.id IN (
       SELECT j.id FROM auto_response_jobs j
        WHERE j.status = 'pending' AND j."notBefore" <= now()
          AND ${QUESTIONNAIRE_ROUTED_SQL}
        ORDER BY j."notBefore" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ?
     )
     RETURNING t.id, t."agencyId", t."conversationId", t."leadId", t.channel, t.reason,
               t."triggerSequence", t.attempts, t."maxAttempts", t."createdAt"
  `,
    [workerId, limit],
  )
  return (res.rows ?? []).map((r: Record<string, unknown>) => ({
    id: Number(r.id),
    agencyId: Number(r.agencyId),
    conversationId: Number(r.conversationId),
    leadId: parseLeadId(r.leadId),
    channel: String(r.channel),
    reason: r.reason as AutoResponseReason,
    triggerSequence: Number(r.triggerSequence),
    attempts: Number(r.attempts),
    maxAttempts: Number(r.maxAttempts),
    createdAt: new Date(r.createdAt as string | Date).toISOString(),
  }))
}
