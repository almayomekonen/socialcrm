import type { Knex } from 'knex'
import { db } from '@/config/db'
import type { TriggerOrigin, TriggerType } from '@/lib/automations/types'

/**
 * automation_jobs — the engine's execution queue (autoResponseJobs clone).
 * Queue verbs: enqueue (trx, conflict-ignore on the dedup key) → claim
 * (FOR UPDATE SKIP LOCKED) → complete | skip | fail (backoff → dead), plus
 * lease reclaim and terminal-row pruning. Jobs are plumbing; the permanent
 * record is automation_activity.
 *
 * Query BUILDERS are exported unawaited so shapes are pinned by `.toSQL()`
 * tests without a live DB (db/today/facts.ts pattern).
 */

export interface AutomationJob {
  id: number
  agencyId: number
  automationId: number
  leadId: number
  trigger: TriggerType
  origin: TriggerOrigin
  eventKey: string
  attempts: number
  maxAttempts: number
  createdAt: string
}

export function enqueueAutomationJobQuery(
  q: Knex.Transaction | Knex,
  args: {
    agencyId: number
    automationId: number
    leadId: number
    trigger: TriggerType
    origin: TriggerOrigin
    eventKey: string
    notBefore: Date
  },
) {
  // SQL-level gate (enqueueAutoResponse philosophy): even on a race, a job is
  // only inserted for a definition that is still active and agency-matched.
  // The dedup unique index absorbs webhook retries via ON CONFLICT DO NOTHING.
  return q.raw(
    `
    INSERT INTO automation_jobs
      ("agencyId","automationId","leadId",trigger,origin,"eventKey",status,"notBefore")
    SELECT :agencyId, :automationId, :leadId, :trigger, :origin, :eventKey, 'pending', :notBefore
    WHERE EXISTS (SELECT 1 FROM automation_definitions d
                   WHERE d.id = :automationId AND d."agencyId" = :agencyId AND d.status = 'active')
    ON CONFLICT ("automationId","leadId","eventKey") DO NOTHING
    RETURNING id
  `,
    { ...args },
  )
}

export async function enqueueAutomationJob(
  trx: Knex.Transaction | Knex,
  args: Parameters<typeof enqueueAutomationJobQuery>[1],
): Promise<number | null> {
  const res = await enqueueAutomationJobQuery(trx, args)
  const row = res.rows?.[0]
  return row ? Number(row.id) : null
}

export function claimAutomationJobsQuery(workerId: string, limit: number) {
  return db.raw(
    `
    UPDATE automation_jobs j
       SET status = 'processing', "lockedAt" = now(), "lockedBy" = ?,
           attempts = attempts + 1, "updatedAt" = now()
     WHERE j.id IN (
       SELECT id FROM automation_jobs
        WHERE status = 'pending' AND "notBefore" <= now()
        ORDER BY "notBefore" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ?
     )
     RETURNING j.id, j."agencyId", j."automationId", j."leadId", j.trigger, j.origin,
               j."eventKey", j.attempts, j."maxAttempts", j."createdAt"
  `,
    [workerId, limit],
  )
}

export async function claimAutomationJobs(workerId: string, limit: number): Promise<AutomationJob[]> {
  const res = await claimAutomationJobsQuery(workerId, limit)
  return (res.rows ?? []).map((r: Record<string, unknown>) => ({
    id: Number(r.id),
    agencyId: Number(r.agencyId),
    automationId: Number(r.automationId),
    leadId: Number(r.leadId),
    trigger: r.trigger as TriggerType,
    origin: r.origin as TriggerOrigin,
    eventKey: String(r.eventKey),
    attempts: Number(r.attempts),
    maxAttempts: Number(r.maxAttempts),
    createdAt: new Date(r.createdAt as string | Date).toISOString(),
  }))
}

export function reclaimStaleAutomationJobsQuery(cutoff: Date) {
  return db.raw(
    `
    UPDATE automation_jobs
       SET status = 'pending', "lockedAt" = NULL, "lockedBy" = NULL,
           "lastError" = 'lease-expired-reclaimed', "updatedAt" = now()
     WHERE status = 'processing' AND "lockedAt" < ?
     RETURNING id
  `,
    [cutoff],
  )
}

export async function reclaimStaleAutomationJobs(leaseMs: number): Promise<number> {
  const res = await reclaimStaleAutomationJobsQuery(new Date(Date.now() - leaseMs))
  return res.rows?.length ?? 0
}

export async function completeAutomationJob(id: number): Promise<void> {
  await db('automation_jobs')
    .where({ id })
    .update({ status: 'done', lockedAt: null, lockedBy: null, updatedAt: db.fn.now() })
}

export async function skipAutomationJob(id: number, skipReason: string): Promise<void> {
  await db('automation_jobs')
    .where({ id })
    .update({ status: 'skipped', skipReason, lockedAt: null, lockedBy: null, updatedAt: db.fn.now() })
}

export function failAutomationJobQuery(id: number, error: string) {
  // Retry with linear backoff; dead-letter once attempts reach maxAttempts
  // (failAutoResponseJob clone).
  return db.raw(
    `
    UPDATE automation_jobs
       SET status = CASE WHEN attempts >= "maxAttempts" THEN 'dead' ELSE 'pending' END,
           "lastError" = ?, "lockedAt" = NULL, "lockedBy" = NULL,
           "notBefore" = now() + (LEAST(attempts, 5) * interval '30 seconds'),
           "updatedAt" = now()
     WHERE id = ?
  `,
    [error, id],
  )
}

export async function failAutomationJob(id: number, error: string): Promise<void> {
  await failAutomationJobQuery(id, error)
}

export function pruneTerminalJobsQuery(cutoff: Date) {
  // Terminal plumbing older than the operational window (migration plan §4.4).
  return db.raw(
    `DELETE FROM automation_jobs
      WHERE status IN ('done','skipped','dead') AND "updatedAt" < ?`,
    [cutoff],
  )
}

export async function pruneTerminalJobs(cutoff: Date): Promise<void> {
  await pruneTerminalJobsQuery(cutoff)
}
