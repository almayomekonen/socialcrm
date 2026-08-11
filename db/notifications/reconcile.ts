import { db } from '@/config/db'

/**
 * Reconciliation reader — spec §14.3.
 *
 * THE GAP THIS CLOSES: the two webhook ingestion paths insert a lead with a bare
 * INSERT, not inside a transaction. A crash between the lead INSERT and the job
 * INSERT would leave a lead that exists with a notification that never will.
 *
 * The fix is NOT to wrap protected ingestion code in a transaction — that would
 * change the behavior of the lead-creation path itself, which is out of bounds.
 * It is to ask, periodically, "which recent leads have no lead.created job?" and
 * offer them again. Re-offering is free: `notification_jobs."eventKey"` is
 * uniquely indexed and the enqueue is ON CONFLICT DO NOTHING, so an event that
 * already landed is a no-op.
 *
 * Read-only against `clients`.
 */

export type MissedLeadRow = { id: number; agencyId: number; firstName: string | null; lastName: string | null }

/**
 * A deliberately SHORT window.
 *
 * Any lead inside the window that has no job gets one, which includes leads
 * created while the feature was switched off. So the window is also the blast
 * radius of turning `NOTIFICATIONS_ENABLED` on: at most this many minutes of
 * already-existing leads can produce a notification at flag-flip. Ten minutes is
 * long enough to cover a crash-and-recover cycle and short enough that enabling
 * the feature cannot dump an afternoon of backlog into someone's bell
 * (care-charter Law 5).
 */
export const RECONCILE_WINDOW_MINUTES = 10

/** Bounds the sweep's cost per cron tick; a genuine backlog drains over ticks. */
export const RECONCILE_LIMIT = 200

export function findLeadsMissingCreatedJobQuery(windowMinutes: number, limit: number) {
  return db.raw(
    `
    SELECT c.id, c."agencyId", c."firstName", c."lastName"
      FROM clients c
     WHERE c."createdAt" >= now() - (? * interval '1 minute')
       AND c.lead = true
       AND NOT EXISTS (
             SELECT 1 FROM notification_jobs j
              WHERE j.type = 'lead.created'
                AND j."entityId" = c.id
                AND j."agencyId" = c."agencyId"
           )
     ORDER BY c."createdAt" ASC
     LIMIT ?
  `,
    [windowMinutes, limit],
  )
}

export async function findLeadsMissingCreatedJob(
  windowMinutes = RECONCILE_WINDOW_MINUTES,
  limit = RECONCILE_LIMIT,
): Promise<MissedLeadRow[]> {
  const res = await findLeadsMissingCreatedJobQuery(windowMinutes, limit)
  return (res.rows ?? []).map((r: Record<string, unknown>) => ({
    id: Number(r.id),
    agencyId: Number(r.agencyId),
    firstName: (r.firstName as string | null) ?? null,
    lastName: (r.lastName as string | null) ?? null,
  }))
}
