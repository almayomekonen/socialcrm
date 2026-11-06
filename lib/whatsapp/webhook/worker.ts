import {
  claimWhatsappEvents,
  failWhatsappEvent,
  pruneSettledWhatsappEvents,
  reclaimStaleWhatsappEvents,
  settleWhatsappEvent,
} from '@/db/whatsappWebhookEvents'
import { runAutoResponseKick } from '@/lib/inbox/autoresponse/kickWorker'
import { processWhatsappEvent, RetryableEventError } from './processEvent'

/**
 * Drains whatsapp_webhook_events. Run right after the webhook's response for that
 * delivery's own receipts, and every minute by the cron for everything due.
 *
 *   reclaim stale leases → claim (SKIP LOCKED, per-customer order) → apply each →
 *   settle, or fail with backoff → drain the auto-response queue once if a reply is owed
 *
 * Concurrent runs are safe: a receipt is leased to one worker, settled only while still
 * leased, and a reclaimed receipt is applied again only through idempotent writes.
 * Logs carry counts and ids only.
 */

export const LEASE_MS = 120_000
const RETENTION_DAYS = 14

export type WorkerSummary = { claimed: number; processed: number; ignored: number; retried: number; reclaimed: number; pruned: number; kicked: boolean }

export async function runWhatsappWebhookWorker(opts: {
  workerId: string
  ids?: number[]
  limit?: number
  budgetMs?: number
  kick?: typeof runAutoResponseKick
}): Promise<WorkerSummary> {
  const started = Date.now()
  const limit = opts.limit ?? 25
  const budgetMs = opts.budgetMs ?? 40_000
  const summary: WorkerSummary = { claimed: 0, processed: 0, ignored: 0, retried: 0, reclaimed: 0, pruned: 0, kicked: false }
  summary.reclaimed = await reclaimStaleWhatsappEvents(LEASE_MS)

  let kick = false
  let delaySeconds = Number.POSITIVE_INFINITY
  // Repeat claims: a customer's second receipt becomes claimable once the first settles.
  while (Date.now() - started < budgetMs) {
    const batch = await claimWhatsappEvents(opts.workerId, limit, opts.ids ? { ids: opts.ids } : {})
    if (batch.length === 0) break
    summary.claimed += batch.length
    for (const row of batch) {
      try {
        const r = await processWhatsappEvent({ agencyId: row.agencyId, phoneNumberId: row.phoneNumberId, kind: row.kind, payload: row.payload })
        await settleWhatsappEvent(row.id, r.outcome, r.detail)
        if (r.outcome === 'processed') summary.processed++
        else summary.ignored++
        if (r.kick) {
          kick = true
          delaySeconds = Math.min(delaySeconds, r.delaySeconds)
        }
      } catch (err) {
        const code = err instanceof RetryableEventError ? err.code : `error:${(err as Error)?.name ?? 'unknown'}`
        await failWhatsappEvent(row.id, code)
        summary.retried++
        console.error('[wa-webhook] event failed; will retry', JSON.stringify({ id: row.id, kind: row.kind, code, attempts: row.attempts }))
      }
    }
  }

  if (kick) {
    summary.kicked = true
    try {
      await (opts.kick ?? runAutoResponseKick)({ delaySeconds: Number.isFinite(delaySeconds) ? delaySeconds : 0, limit: 5 })
    } catch (err) {
      console.error('[wa-webhook] auto-response kick failed', JSON.stringify({ name: (err as Error)?.name ?? null }))
    }
  }
  if (!opts.ids) summary.pruned = await pruneSettledWhatsappEvents(RETENTION_DAYS)
  console.log('[wa-webhook] worker', JSON.stringify({ workerId: opts.workerId, ...summary }))
  return summary
}
