import type { Knex } from 'knex'
import { db } from '@/config/db'

export interface AutoResponseJob {
  id: number
  agencyId: number
  conversationId: number
  leadId: number
  channel: string
  reason: 'first_contact'
  triggerSequence: number
  attempts: number
  maxAttempts: number
  createdAt: string
}

export async function enqueueAutoResponse(
  trx: Knex.Transaction,
  args: { agencyId: number; conversationId: number; leadId: number; channel: string; triggerSequence: number },
): Promise<number | null> {
  const res = await trx.raw(
    `
    INSERT INTO auto_response_jobs
      ("agencyId","conversationId","leadId",channel,reason,"triggerSequence",status,"notBefore")
    SELECT :agencyId, :conversationId, :leadId, :channel, 'first_contact', :triggerSequence, 'pending', now()
    WHERE EXISTS (SELECT 1 FROM agencies a WHERE a.id = :agencyId AND a."autoResponseEnabled" = true)
      AND EXISTS (SELECT 1 FROM auto_response_settings s
                   WHERE s."agencyId" = :agencyId AND s.channel = :channel AND s.enabled = true)
      AND NOT EXISTS (SELECT 1 FROM auto_response_jobs j
                       WHERE j."conversationId" = :conversationId AND j.reason = 'first_contact'
                         AND j.status IN ('pending','processing','sent'))
    ON CONFLICT DO NOTHING
    RETURNING id
  `,
    args,
  )
  const row = res.rows?.[0]
  if (!row) return null
  // [IRE-OBS] temporary observability.
  console.log(`[IRE] enqueued conv=${args.conversationId} job=${row.id} agency=${args.agencyId}`)
  return Number(row.id)
}

export async function claimAutoResponseJobs(workerId: string, limit: number): Promise<AutoResponseJob[]> {
  const res = await db.raw(
    `
    UPDATE auto_response_jobs j
       SET status = 'processing', "lockedAt" = now(), "lockedBy" = ?,
           attempts = attempts + 1, "updatedAt" = now()
     WHERE j.id IN (
       SELECT id FROM auto_response_jobs
        WHERE status = 'pending' AND "notBefore" <= now()
        ORDER BY "notBefore" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ?
     )
     RETURNING j.id, j."agencyId", j."conversationId", j."leadId", j.channel, j.reason,
               j."triggerSequence", j.attempts, j."maxAttempts", j."createdAt"
  `,
    [workerId, limit],
  )
  return (res.rows ?? []).map((r: Record<string, unknown>) => ({
    id: Number(r.id),
    agencyId: Number(r.agencyId),
    conversationId: Number(r.conversationId),
    leadId: Number(r.leadId),
    channel: String(r.channel),
    reason: 'first_contact' as const,
    triggerSequence: Number(r.triggerSequence),
    attempts: Number(r.attempts),
    maxAttempts: Number(r.maxAttempts),
    createdAt: new Date(r.createdAt as string | Date).toISOString(),
  }))
}

export async function reclaimStaleAutoResponseJobs(leaseMs: number): Promise<number> {
  const cutoff = new Date(Date.now() - leaseMs)
  const res = await db.raw(
    `
    UPDATE auto_response_jobs
       SET status = 'pending', "lockedAt" = NULL, "lockedBy" = NULL,
           "lastError" = 'lease-expired-reclaimed', "updatedAt" = now()
     WHERE status = 'processing' AND "lockedAt" < ?
     RETURNING id
  `,
    [cutoff],
  )
  return res.rows?.length ?? 0
}

export async function completeAutoResponseJob(id: number, sentMessageId: number | null): Promise<void> {
  await db('auto_response_jobs').where({ id }).update({
    status: 'sent',
    sentMessageId,
    lockedAt: null,
    lockedBy: null,
    updatedAt: db.fn.now(),
  })
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

/** Retry with backoff; dead-letter once attempts reach maxAttempts. */
export async function failAutoResponseJob(id: number, error: string): Promise<void> {
  await db.raw(
    `
    UPDATE auto_response_jobs
       SET status = CASE WHEN attempts >= "maxAttempts" THEN 'dead' ELSE 'pending' END,
           "lastError" = ?, "lockedAt" = NULL, "lockedBy" = NULL,
           "notBefore" = now() + (LEAST(attempts, 5) * interval '30 seconds'),
           "updatedAt" = now()
     WHERE id = ?
  `,
    [error, id],
  )
}

export async function countSentToday(agencyId: number): Promise<number> {
  const res = await db.raw(
    `SELECT count(*)::int AS c FROM auto_response_jobs
      WHERE "agencyId" = ? AND status = 'sent' AND "updatedAt" >= date_trunc('day', now())`,
    [agencyId],
  )
  return Number(res.rows?.[0]?.c ?? 0)
}

export async function hasSentFirstContact(conversationId: number): Promise<boolean> {
  const res = await db.raw(
    `SELECT 1 FROM auto_response_jobs
      WHERE "conversationId" = ? AND reason = 'first_contact' AND status = 'sent' LIMIT 1`,
    [conversationId],
  )
  return (res.rows?.length ?? 0) > 0
}
