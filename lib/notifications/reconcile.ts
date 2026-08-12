import { findLeadsMissingCreatedJob, RECONCILE_LIMIT, RECONCILE_WINDOW_MINUTES } from '@/db/notifications/reconcile'
import { isNotificationsEnabled } from './flags'
import { emitLeadCreated } from './emitLeadCreated'
import { leadDisplayName } from './leadName'

/**
 * Reconciliation sweep — spec §14.3. The safety net under the webhook ingestion
 * paths, which enqueue outside any transaction.
 *
 * Runs from the cron, after the drain. Idempotent by construction: it goes
 * through `emitLeadCreated` → `notifyEvent`, so every event is subject to the
 * same kill switch and the same agency allowlist as a live emission, and the
 * uniquely-indexed `eventKey` turns an already-enqueued event into a no-op.
 * There is no path here that can produce a duplicate notification.
 *
 * Origin safety (Task 3B): the reader only returns leads with durable
 * `createOrigin` that is not `import` (legacy NULL and imports never enter this
 * loop). Emission uses `origin: 'reconcile'` so live import silence stays solely
 * in `shouldEmitLeadCreated` / the SQL candidate filter — not reimplemented here.
 */

export type ReconcileSummary = { scanned: number; enqueued: number; skipped: number }

export async function reconcileMissedLeadCreated(opts?: {
  windowMinutes?: number
  limit?: number
}): Promise<ReconcileSummary> {
  const summary: ReconcileSummary = { scanned: 0, enqueued: 0, skipped: 0 }

  // Checked here as well as inside notifyEvent so that a disabled system runs no
  // sweep QUERY either — off means off, including the read (spec §23.1).
  if (!isNotificationsEnabled()) return summary

  try {
    const rows = await findLeadsMissingCreatedJob(
      opts?.windowMinutes ?? RECONCILE_WINDOW_MINUTES,
      opts?.limit ?? RECONCILE_LIMIT,
    )
    summary.scanned = rows.length

    for (const row of rows) {
      const result = await emitLeadCreated({
        agencyId: row.agencyId,
        leadId: row.id,
        leadName: leadDisplayName(row),
        // No actor: by the time the sweep sees it, who created the lead is not
        // recoverable from this row. Null means "system", so nobody is dropped
        // as self-authored — the assigned handler still hears about their lead.
        actorUserId: null,
        occurredAt: new Date(),
        origin: 'reconcile',
      })
      if (result.enqueued) summary.enqueued++
      else summary.skipped++
    }

    if (summary.enqueued > 0) {
      console.log('[notifications][reconcile]', { ...summary, reason: 'recovered_missing_lead_created' })
    }
  } catch (err) {
    // The sweep is a net, not a guarantee. A failed sweep must never fail the
    // cron request that also drains the queue.
    console.error('[notifications][reconcile] sweep failed (swallowed)', { err: String(err) })
  }

  return summary
}
