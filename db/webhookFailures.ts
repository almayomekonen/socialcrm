import { db } from '@/config/db'
import { backoffSeconds, type FailureResolution } from '@/lib/facebook/webhookFailurePolicy'

/**
 * The Meta lead-ingestion dead-letter queue — data layer.
 *
 * Both webhooks answer 200 unconditionally, so Meta never retries and this table
 * is the ONLY chance a failed lead has. Every function here is written for that
 * responsibility: recording never throws (it runs inside a webhook that must
 * return 200), and claiming is race-safe (the cron can overlap itself).
 *
 * AGENCY SCOPE. `agency_id` is resolved from the Page, never from a payload. It
 * is nullable for historical rows written before the column existed; the worker
 * backfills it on the first attempt, and a NULL agency is never notified about.
 */

export type WebhookFailureRow = {
  id: number
  lead_id: string
  page_id: string
  agency_id: number | null
  error_type: string
  attempts: number
  max_attempts: number
}

/**
 * Record (or refresh) one ingestion failure. NEVER THROWS.
 *
 * Upserts against the partial unique index on `(page_id, lead_id) WHERE status =
 * 'pending'`, so repeated failures of the SAME lead across Meta redeliveries
 * update one open row instead of queueing the same lead N times. `attempts` is
 * deliberately NOT reset — a redelivery is not a fresh start, or a permanently
 * broken lead could never exhaust its budget.
 */
export async function recordWebhookFailure(input: {
  leadId: string
  pageId: string
  agencyId?: number | null
  errorType: string
  errorDetail?: string | null
}): Promise<void> {
  try {
    await db('webhook_failures')
      .insert({
        lead_id: input.leadId,
        page_id: input.pageId,
        agency_id: input.agencyId ?? null,
        error_type: input.errorType,
        error_detail: input.errorDetail ?? null,
        last_error: input.errorDetail ?? null,
        status: 'pending',
        next_attempt_at: new Date(Date.now() + backoffSeconds(0) * 1000),
      })
      .onConflict(db.raw(`(page_id, lead_id) WHERE status = 'pending'`) as never)
      .merge({
        error_type: input.errorType,
        error_detail: input.errorDetail ?? null,
        last_error: input.errorDetail ?? null,
        updated_at: new Date(),
      })
  } catch (err) {
    // The webhook must still answer 200. A ledger write is not worth a retry storm.
    console.error('[webhookFailures] record failed (swallowed)', {
      leadId: input.leadId,
      err: String(err),
    })
  }
}

/**
 * Claim due failures for one worker pass.
 *
 * `FOR UPDATE SKIP LOCKED` is what makes overlapping cron invocations safe: two
 * passes take disjoint rows rather than both retrying the same lead against
 * Meta. The batch is bounded by the caller — this queue exists to recover leads
 * gently, never to burst requests at Meta.
 */
export async function claimDueFailures(limit: number): Promise<WebhookFailureRow[]> {
  const rows = await db('webhook_failures')
    .where('status', 'pending')
    .where('next_attempt_at', '<=', new Date())
    .orderBy('next_attempt_at', 'asc')
    .limit(Math.max(1, Math.min(limit, 50)))
    .forUpdate()
    .skipLocked()
    .select('id', 'lead_id', 'page_id', 'agency_id', 'error_type', 'attempts', 'max_attempts')

  return rows as WebhookFailureRow[]
}

/** Terminal success. The lead exists; nothing more is owed. */
export async function markFailureResolved(id: number, resolution: FailureResolution): Promise<void> {
  await db('webhook_failures').where({ id }).update({
    status: 'resolved',
    // The legacy boolean is kept in sync so any older reader stays correct.
    resolved: true,
    resolution,
    resolved_at: new Date(),
    updated_at: new Date(),
  })
}

/** Terminal failure. We stopped trying, and the reason is recorded. */
export async function markFailureDead(id: number, resolution: FailureResolution, lastError?: string | null): Promise<void> {
  await db('webhook_failures')
    .where({ id })
    .update({
      status: 'dead',
      resolution,
      resolved_at: new Date(),
      last_error: lastError ?? null,
      updated_at: new Date(),
    })
}

/** Another attempt is owed. Stores the post-attempt count and the next due time. */
export async function rescheduleFailure(
  id: number,
  attempts: number,
  retryInSeconds: number,
  lastError?: string | null,
): Promise<void> {
  await db('webhook_failures')
    .where({ id })
    .update({
      attempts,
      next_attempt_at: new Date(Date.now() + retryInSeconds * 1000),
      last_error: lastError ?? null,
      updated_at: new Date(),
    })
}

/** Backfill the tenant once the Page has been resolved. Historical rows only. */
export async function setFailureAgency(id: number, agencyId: number): Promise<void> {
  await db('webhook_failures').where({ id }).whereNull('agency_id').update({ agency_id: agencyId })
}

/**
 * THE OPERATIONAL VIEW — what has this agency lost, and what are we still
 * trying to recover. Agency-scoped builder; not executed here, so its SQL can be
 * pinned by a `.toSQL()` test the way the repo does elsewhere.
 */
export function unresolvedFailuresQuery(agencyId: number) {
  return db('webhook_failures')
    .where({ agency_id: agencyId })
    .whereIn('status', ['pending', 'dead'])
    .orderBy('created_at', 'desc')
    .select('id', 'lead_id', 'page_id', 'error_type', 'status', 'attempts', 'resolution', 'created_at', 'next_attempt_at')
}

/** Cross-tenant health counters for the platform operator. */
export async function failureCounts(): Promise<{ pending: number; dead: number }> {
  const rows = (await db('webhook_failures')
    .whereIn('status', ['pending', 'dead'])
    .groupBy('status')
    .select('status', db.raw('COUNT(*)::int as n'))) as { status: string; n: number }[]

  return {
    pending: rows.find((r) => r.status === 'pending')?.n ?? 0,
    dead: rows.find((r) => r.status === 'dead')?.n ?? 0,
  }
}
