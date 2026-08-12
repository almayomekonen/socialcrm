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
 * Origin safety (Task 3B): only product leads with a durable `createOrigin` that
 * is not `import` are candidates. Legacy NULL rows and Excel/CSV imports are
 * never resurrected. Selection uses `clients.createOrigin` only — never
 * `leadSource` heuristics or automation tables. Silence policy for live import
 * remains in `emitLeadCreated`; reconcile emits via that helper with
 * `origin: 'reconcile'`.
 *
 * Read-only against `clients`.
 */

export type MissedLeadRow = { id: number; agencyId: number; firstName: string | null; lastName: string | null }

/**
 * The recovery window, fixed by spec §14.3 at 30 minutes — the same figure §25
 * limitation 3 publishes as the honest worst case ("may be up to 30 minutes
 * late... never lost").
 *
 * The window is what makes "late, not lost" true, so it is a DURABILITY figure
 * and not a tuning knob. With the every-minute cron (§23.3) a missed enqueue
 * gets ~30 chances to be recovered; shortening it trades that guarantee away,
 * because once a lead leaves the window nothing looks for it again.
 *
 * One consequence to keep in mind rather than solve here: any lead inside the
 * window with no job gets one, including leads created while the feature was
 * switched off, so the window is also what a flag flip can surface at once. That
 * is a separate concern with a separate fix (ignore leads created before the
 * enable moment) — narrowing the recovery window to control it would weaken
 * durability to solve a rollout problem.
 */
export const RECONCILE_WINDOW_MINUTES = 30

/** Bounds the sweep's cost per cron tick; a genuine backlog drains over ticks. */
export const RECONCILE_LIMIT = 200

export function findLeadsMissingCreatedJobQuery(windowMinutes: number, limit: number) {
  return db.raw(
    `
    SELECT c.id, c."agencyId", c."firstName", c."lastName"
      FROM clients c
     WHERE c."createdAt" >= now() - (? * interval '1 minute')
       AND c.lead = true
       AND c."createOrigin" IS NOT NULL
       AND c."createOrigin" <> 'import'
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
