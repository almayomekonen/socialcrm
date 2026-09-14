import { ingestMessengerEvent } from '@/lib/facebook/messenger/ingestMessengerEvent'
import { fillMessengerCustomerName } from '@/lib/facebook/messenger/profile'
import { describeDbError } from '@/lib/system/dbErrorInfo'
import {
  claimMessengerEvents,
  failMessengerEvent,
  pruneSettledMessengerEvents,
  reclaimStaleMessengerEvents,
  settleMessengerEvent,
  type MessengerEventRow,
} from '@/db/messengerWebhookEvents'

/**
 * Drain messenger_webhook_events. Runs right after the webhook responds (for
 * that delivery's receipts) and from a cron backstop (everything due, plus
 * stale-lease reclaim and retention pruning).
 *
 * Every receipt ends in exactly one state: `processed` (stored, or already
 * stored), `ignored` (nothing to store, with the reason), or back to `received`
 * behind a backoff after a failure — and `failed` once its attempt budget is
 * spent, where it stays until an operator requeues it. Nothing is dropped
 * silently.
 *
 * Re-processing is harmless: a reclaimed receipt whose message was already
 * stored lands on the ("pageId", mid) uniqueness and settles as `duplicate`.
 */

export type MessengerWorkerSummary = {
  claimed: number
  processed: number
  duplicates: number
  ignored: number
  retried: number
  failed: number
  reclaimed: number
  pruned: number
  budgetExhausted: boolean
}

export type MessengerWorkerOptions = {
  workerId?: string
  /** Only these receipts (the post-response kick). Omit for the cron backstop. */
  ids?: number[]
  limit?: number
  batchSize?: number
  budgetMs?: number
  leaseMs?: number
  retentionDays?: number
  now?: () => number
}

const DEFAULT_LIMIT = 100
const DEFAULT_BATCH_SIZE = 20
const DEFAULT_BUDGET_MS = 20_000
const DEFAULT_LEASE_MS = 2 * 60 * 1000
const DEFAULT_RETENTION_DAYS = 30

export async function processMessengerEvent(row: MessengerEventRow): Promise<'stored' | 'duplicate' | 'ignored' | 'failed'> {
  try {
    const result = await ingestMessengerEvent(row.pageId, row.payload, { expectedAgencyId: row.agencyId })
    if (result.status === 'stored') {
      await settleMessengerEvent(row.id, 'processed', 'stored')
      if (result.direction === 'inbound' && result.newConversation) {
        await fillMessengerCustomerName({ conversationId: result.conversationId, agencyId: result.agencyId, pageId: row.pageId })
      }
      return 'stored'
    }
    if (result.status === 'duplicate') {
      await settleMessengerEvent(row.id, 'processed', 'duplicate')
      return 'duplicate'
    }
    await settleMessengerEvent(row.id, 'ignored', result.reason)
    return 'ignored'
  } catch (err) {
    await failMessengerEvent(row.id, describeDbError(err).summary)
    return 'failed'
  }
}

export async function runMessengerEventWorker(opts: MessengerWorkerOptions = {}): Promise<MessengerWorkerSummary> {
  const now = opts.now ?? (() => Date.now())
  const started = now()
  const workerId = opts.workerId ?? `messenger-${Math.random().toString(36).slice(2, 10)}`
  const limit = opts.limit ?? DEFAULT_LIMIT
  const batchSize = Math.min(opts.batchSize ?? DEFAULT_BATCH_SIZE, limit)
  const budgetMs = opts.budgetMs ?? DEFAULT_BUDGET_MS
  const backstop = !opts.ids
  const summary: MessengerWorkerSummary = {
    claimed: 0,
    processed: 0,
    duplicates: 0,
    ignored: 0,
    retried: 0,
    failed: 0,
    reclaimed: 0,
    pruned: 0,
    budgetExhausted: false,
  }

  if (backstop) summary.reclaimed = await reclaimStaleMessengerEvents(opts.leaseMs ?? DEFAULT_LEASE_MS, now())

  while (summary.claimed < limit) {
    if (now() - started > budgetMs) {
      summary.budgetExhausted = true
      break
    }
    const rows = await claimMessengerEvents(workerId, Math.min(batchSize, limit - summary.claimed), { ids: opts.ids })
    if (rows.length === 0) break
    summary.claimed += rows.length
    for (const row of rows) {
      if (row.attempts > 1) summary.retried++
      const outcome = await processMessengerEvent(row)
      if (outcome === 'stored') summary.processed++
      else if (outcome === 'duplicate') summary.duplicates++
      else if (outcome === 'ignored') summary.ignored++
      else summary.failed++
    }
    if (opts.ids) break
  }

  if (backstop) summary.pruned = await pruneSettledMessengerEvents(opts.retentionDays ?? DEFAULT_RETENTION_DAYS)
  return summary
}
