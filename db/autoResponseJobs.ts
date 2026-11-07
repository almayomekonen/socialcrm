import type { Knex } from 'knex'
import { db } from '@/config/db'
import { QUESTIONNAIRE_ROUTED_SQL } from './questionnaireJobs'
import { parkedRow, type ParkedAutoResponseJob } from './autoResponseSendMarker'

export type { ParkedAutoResponseJob } from './autoResponseSendMarker'

export type AutoResponseReason =
  | 'first_contact'
  | 'qualify_turn'
  | 'no_response_warning'
  | 'no_response_close'
  | 'questionnaire_turn'

export const NO_RESPONSE_JOB_REASONS: AutoResponseReason[] = ['no_response_warning', 'no_response_close']

export interface AutoResponseJob {
  id: number
  agencyId: number
  conversationId: number
  /** Null = non-personal Contact IRE job. Positive id = existing Lead. */
  leadId: number | null
  channel: string
  reason: AutoResponseReason
  triggerSequence: number
  attempts: number
  maxAttempts: number
  createdAt: string
  /** The worker running this claim. Set by the worker; failure writes are owner-checked against it. */
  ownerWorkerId?: string
}

function parseLeadId(value: unknown): number | null {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Enqueue an auto-response job. `reason` defaults to 'first_contact' so existing
 * acknowledge-mode callers are unchanged. For 'qualify_turn' the first-contact
 * "already acted" guard is skipped (one job per customer turn); the partial unique
 * index auto_response_jobs_inflight_uniq still enforces at most one in-flight job
 * per conversation (turn-taking), via ON CONFLICT DO NOTHING.
 */
export async function enqueueAutoResponse(
  trx: Knex.Transaction,
  args: {
    agencyId: number
    conversationId: number
    leadId: number | null
    channel: string
    triggerSequence: number
    reason?: AutoResponseReason
    /** Seconds to wait before the worker may claim the job (uses existing notBefore). */
    delaySeconds?: number
  },
): Promise<number | null> {
  const reason: AutoResponseReason = args.reason ?? 'first_contact'
  const delaySeconds = Number.isFinite(args.delaySeconds)
    ? Math.min(Math.max(Math.floor(args.delaySeconds as number), 0), 3600)
    : 0
  const res = await trx.raw(
    `
    INSERT INTO auto_response_jobs
      ("agencyId","conversationId","leadId",channel,reason,"triggerSequence",status,"notBefore")
    SELECT :agencyId, :conversationId, :leadId, :channel, :reason, :triggerSequence, 'pending',
           now() + make_interval(secs => :delaySeconds)
    WHERE EXISTS (SELECT 1 FROM agencies a WHERE a.id = :agencyId AND a."autoResponseEnabled" = true)
      AND EXISTS (SELECT 1 FROM auto_response_settings s
                   WHERE s."agencyId" = :agencyId AND s.channel = :channel AND s.enabled = true)
      AND (
        :reason <> 'first_contact'
        OR NOT EXISTS (SELECT 1 FROM auto_response_jobs j
                        WHERE j."conversationId" = :conversationId AND j.reason = 'first_contact'
                          AND j.status IN ('pending','processing','sent'))
      )
      AND (
        :reason NOT IN ('no_response_warning', 'no_response_close')
        OR NOT EXISTS (SELECT 1 FROM auto_response_jobs j
                        WHERE j."conversationId" = :conversationId AND j.reason = :reason
                          AND j."triggerSequence" = :triggerSequence
                          AND j.status IN ('pending','processing','sent'))
      )
    ON CONFLICT DO NOTHING
    RETURNING id
  `,
    {
      agencyId: args.agencyId,
      conversationId: args.conversationId,
      leadId: args.leadId,
      channel: args.channel,
      triggerSequence: args.triggerSequence,
      reason,
      delaySeconds,
    },
  )
  const row = res.rows?.[0]
  if (!row) return null
  // [IRE-OBS] temporary observability.
  console.log(`[IRE] enqueued conv=${args.conversationId} job=${row.id} reason=${reason} agency=${args.agencyId}`)
  return Number(row.id)
}

/**
 * The AI worker's claim. It deliberately cannot see questionnaire work: the
 * `NOT (…)` below is the other half of the routing boundary defined in
 * db/questionnaireJobs.ts. A business on the questionnaire, or a conversation
 * with a live session, is invisible here — which is what makes "a questionnaire
 * turn never reaches a model" a property of the query rather than a promise
 * made by a branch somewhere downstream.
 */
export async function claimAutoResponseJobs(workerId: string, limit: number): Promise<AutoResponseJob[]> {
  const res = await db.raw(
    `
    UPDATE auto_response_jobs t
       SET status = 'processing', "lockedAt" = now(), "lockedBy" = ?,
           attempts = attempts + 1, "updatedAt" = now()
     WHERE t.id IN (
       SELECT j.id FROM auto_response_jobs j
        WHERE j.status = 'pending' AND j."notBefore" <= now()
          AND NOT ${QUESTIONNAIRE_ROUTED_SQL}
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

/**
 * A `processing` job whose lease expired: its worker died or stalled. Every
 * claim already counted one attempt, so a job that has used all of them is
 * dead-lettered here instead of going back to `pending` — without this, a turn
 * that always outlives its lease was re-claimed (and re-generated) forever.
 *
 * A job whose send had STARTED (`sendStartedAt`) is never returned to the queue:
 * its worker may have died after Meta accepted the message. It is parked as
 * `skipped` / `send_outcome_unknown` and passed to `onParked` so the caller can
 * hand the conversation to a person. Returns how many rows it touched.
 */
export async function reclaimStaleAutoResponseJobs(
  leaseMs: number,
  onParked?: (jobs: ParkedAutoResponseJob[]) => Promise<void>,
): Promise<number> {
  const cutoff = new Date(Date.now() - leaseMs)
  const res = await db.raw(
    `
    UPDATE auto_response_jobs
       SET status = CASE WHEN "sendStartedAt" IS NOT NULL THEN 'skipped'
                         ELSE CASE WHEN attempts >= "maxAttempts" THEN 'dead' ELSE 'pending' END END,
           "skipReason" = CASE WHEN "sendStartedAt" IS NOT NULL THEN ? ELSE "skipReason" END,
           "lastError" = CASE WHEN "sendStartedAt" IS NOT NULL THEN 'lease-expired-after-send-started'
                              ELSE CASE WHEN attempts >= "maxAttempts" THEN 'lease-expired-max-attempts' ELSE 'lease-expired-reclaimed' END END,
           "lockedAt" = NULL, "lockedBy" = NULL, "updatedAt" = now()
     WHERE status = 'processing' AND "lockedAt" < ?
     RETURNING id, "agencyId", "conversationId", "leadId", status, "skipReason"
  `,
    [SEND_OUTCOME_UNKNOWN, cutoff],
  )
  const rows = (res.rows ?? []) as Record<string, unknown>[]
  const parked = rows.filter((r) => r.status === 'skipped' && r.skipReason === SEND_OUTCOME_UNKNOWN).map(parkedRow)
  if (parked.length && onParked) await onParked(parked)
  return rows.length
}

/**
 * Heartbeat: the claiming worker keeps its lease alive while it runs, so a
 * slow but healthy turn is never re-claimed. Only the owner can renew.
 * False means this worker no longer owns the job.
 */
export async function renewAutoResponseJobLease(id: number, workerId: string): Promise<boolean> {
  const n = await db('auto_response_jobs')
    .where({ id, status: 'processing', lockedBy: workerId })
    .update({ lockedAt: db.fn.now(), updatedAt: db.fn.now() })
  return Number(n) > 0
}

/** The fence before an external side effect (a WhatsApp send). */
export async function ownsAutoResponseJob(id: number, workerId: string): Promise<boolean> {
  const row = await db('auto_response_jobs').where({ id, status: 'processing', lockedBy: workerId }).first('id')
  return !!row
}

/** Complete only while still claimed. Inbound may have already set skipped. */
export async function completeAutoResponseJob(id: number, sentMessageId: number | null): Promise<boolean> {
  const n = await db('auto_response_jobs').where({ id, status: 'processing' }).update({
    status: 'sent',
    sentMessageId,
    lockedAt: null,
    lockedBy: null,
    updatedAt: db.fn.now(),
  })
  return Number(n) > 0
}

export async function skipPendingNoResponseJobs(trx: Knex.Transaction, conversationId: number): Promise<number> {
  const n = await trx('auto_response_jobs')
    .where({ conversationId })
    .whereIn('status', ['pending', 'processing'])
    .whereIn('reason', NO_RESPONSE_JOB_REASONS)
    .update({
      status: 'skipped',
      skipReason: 'inbound_superseded',
      lockedAt: null,
      lockedBy: null,
      updatedAt: trx.fn.now(),
    })
  return Number(n) || 0
}

/** Quiet-hours defer: keep pending, undo the claim attempt, set notBefore to the next window. */
export async function deferAutoResponseJob(id: number, notBefore: Date, lastError = 'quiet_hours_deferred'): Promise<void> {
  await db.raw(
    `
    UPDATE auto_response_jobs
       SET status = 'pending',
           "lockedAt" = NULL,
           "lockedBy" = NULL,
           attempts = GREATEST(attempts - 1, 0),
           "lastError" = ?,
           "notBefore" = ?,
           "updatedAt" = now()
     WHERE id = ?
  `,
    [lastError, notBefore, id],
  )
}

export async function skipAutoResponseJob(id: number, skipReason: string): Promise<void> {
  await db('auto_response_jobs').where({ id }).update({
    status: 'skipped',
    skipReason,
    lockedAt: null,
    lockedBy: null,
    updatedAt: db.fn.now(),
  })
}

/**
 * Immediate dead-letter using the existing `dead` status — independent of the
 * attempt counter. Account-level Meta blocks are not transient. With
 * `ownerWorkerId`, only while that worker still owns the running claim (a stale
 * worker touches nothing), exactly like failAutoResponseJob.
 */
export async function deadLetterAutoResponseJob(id: number, error: string, ownerWorkerId?: string): Promise<void> {
  await db('auto_response_jobs').where(ownerWorkerId ? { id, status: 'processing', lockedBy: ownerWorkerId } : { id }).update({
    status: 'dead',
    lastError: error,
    lockedAt: null,
    lockedBy: null,
    updatedAt: db.fn.now(),
  })
}

/** skipReason of a job whose send may have reached the customer. Never retried. */
export const SEND_OUTCOME_UNKNOWN = 'send_outcome_unknown'

/**
 * The send's outcome is unknown (timeout, dropped connection, no message id):
 * the customer may already have the message. Terminal on the existing `skipped`
 * status, so neither the cron nor a reclaim runs it again. Only while still
 * claimed, so a job another path already ended is left as it is.
 */
export async function parkAmbiguousAutoResponseJob(id: number, detail: string): Promise<boolean> {
  const n = await db('auto_response_jobs').where({ id, status: 'processing' }).update({
    status: 'skipped',
    skipReason: SEND_OUTCOME_UNKNOWN,
    lastError: detail.slice(0, 500),
    lockedAt: null,
    lockedBy: null,
    updatedAt: db.fn.now(),
  })
  return Number(n) > 0
}

/**
 * Retry with backoff; dead-letter once attempts reach maxAttempts.
 * With `ownerWorkerId`, only while that worker still owns the claim, so a
 * worker that lost its lease can never reset another worker's run. Without it,
 * still only a job that is running: a job already ended (sent, skipped, parked
 * after an unknown send outcome) is never put back in the queue by a late call.
 *
 * A job whose send had STARTED (`sendStartedAt` still set — nothing proved Meta
 * refused it) is parked as `skipped` / `send_outcome_unknown` in the same
 * statement, never retried: e.g. the send succeeded and persisting it threw.
 * Returns that job when it was parked, so the caller can escalate it.
 */
export async function failAutoResponseJob(id: number, error: string, ownerWorkerId?: string): Promise<ParkedAutoResponseJob | null> {
  const res = await db.raw(
    `
    UPDATE auto_response_jobs
       SET status = CASE WHEN "sendStartedAt" IS NOT NULL THEN 'skipped'
                         ELSE CASE WHEN attempts >= "maxAttempts" THEN 'dead' ELSE 'pending' END END,
           "skipReason" = CASE WHEN "sendStartedAt" IS NOT NULL THEN ? ELSE "skipReason" END,
           "lastError" = ?, "lockedAt" = NULL, "lockedBy" = NULL,
           "notBefore" = now() + (LEAST(attempts, 5) * interval '30 seconds'),
           "updatedAt" = now()
     WHERE id = ? AND status = 'processing' ${ownerWorkerId ? `AND "lockedBy" = ?` : ''}
     RETURNING id, "agencyId", "conversationId", "leadId", status, "skipReason"
  `,
    ownerWorkerId ? [SEND_OUTCOME_UNKNOWN, error, id, ownerWorkerId] : [SEND_OUTCOME_UNKNOWN, error, id],
  )
  const row = (res.rows ?? [])[0] as Record<string, unknown> | undefined
  return row && row.status === 'skipped' && row.skipReason === SEND_OUTCOME_UNKNOWN ? parkedRow(row) : null
}

export async function countSentToday(agencyId: number): Promise<number> {
  const res = await db.raw(
    `SELECT count(*)::int AS c FROM auto_response_jobs
      WHERE "agencyId" = ? AND status = 'sent' AND "updatedAt" >= date_trunc('day', now())
        AND reason NOT IN ('no_response_warning','no_response_close')`,
    [agencyId],
  )
  return Number(res.rows?.[0]?.c ?? 0)
}

/**
 * The one first-contact reply was sent — or may have been (its outcome is
 * unknown). Either way the acknowledge path must not send another one.
 */
export async function hasSentFirstContact(conversationId: number): Promise<boolean> {
  const res = await db.raw(
    `SELECT 1 FROM auto_response_jobs
      WHERE "conversationId" = ? AND reason = 'first_contact'
        AND (status = 'sent' OR (status = 'skipped' AND "skipReason" = ?)) LIMIT 1`,
    [conversationId, SEND_OUTCOME_UNKNOWN],
  )
  return (res.rows?.length ?? 0) > 0
}
