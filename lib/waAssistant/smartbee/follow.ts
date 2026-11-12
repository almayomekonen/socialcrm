import 'server-only'
import { after } from 'next/server'
import { isSmartbeeAgency, smartbeeAgencyIds } from '@/lib/flags/smartbeeFlags'
import { loadSmartbeeConnection } from '@/db/smartbee/connections'
import { claimDueSmartbeeDocuments, claimSmartbeeDocument, unnotifiedTerminalDocuments, type SmartbeeDocumentRow } from '@/db/smartbee/documents'
import { advanceSmartbeeDocument, isTerminal, type LifecycleDeps } from '@/lib/integrations/providers/smartbee/lifecycle'
import { notifyOwnerOfSmartbeeDocument, type SmartbeeNoticeDeps } from './notice'

/**
 * Carries an approved SmartBee request to its outcome, without making the
 * WhatsApp reply wait.
 *
 * FOLLOW (after the tap, inside the same function via `after()`): submit, then
 * poll on SmartBee's schedule (1s, 2s, 4s…) for up to FOLLOW_BUDGET_MS, then
 * tell the owner once. Whatever is unfinished is left exactly where it is.
 *
 * SWEEP (the assistant's minute cron): rows that are due, plus terminal rows
 * whose owner was not told. Rows are claimed with a lease, so the follow-up and
 * the cron never work one row together. Inert when SMARTBEE_AGENCY_IDS is empty
 * (no query at all).
 *
 * NEVER THROWS into the caller: the request is already durable, and the next
 * tick continues from the stored row.
 */

export const FOLLOW_BUDGET_MS = 40_000
const LEASE_MS = 45_000
const SWEEP_BATCH = 5
const NOTICE_WINDOW_MS = 48 * 60 * 60 * 1000

export type FollowDeps = { lifecycle?: LifecycleDeps; notice?: SmartbeeNoticeDeps; sleep?: (ms: number) => Promise<void>; now?: () => number }

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function step(row: SmartbeeDocumentRow, nowMs: number, deps: FollowDeps): Promise<SmartbeeDocumentRow> {
  const connection = await loadSmartbeeConnection(row.agencyId)
  return advanceSmartbeeDocument(row, connection, nowMs, deps.lifecycle)
}

async function finish(row: SmartbeeDocumentRow, deps: FollowDeps): Promise<void> {
  if (isTerminal(row.status)) await notifyOwnerOfSmartbeeDocument({ agencyId: row.agencyId, documentId: row.id, deps: deps.notice })
}

export async function followSmartbeeDocument(input: { agencyId: number; documentId: number; deps?: FollowDeps }): Promise<SmartbeeDocumentRow['status'] | 'skipped'> {
  const deps = input.deps ?? {}
  const now = deps.now ?? Date.now
  const sleep = deps.sleep ?? realSleep
  const deadline = now() + FOLLOW_BUDGET_MS
  let last: SmartbeeDocumentRow['status'] | 'skipped' = 'skipped'
  try {
    while (now() < deadline) {
      if (!isSmartbeeAgency(input.agencyId)) return last
      const claimed = await claimSmartbeeDocument(input.agencyId, input.documentId, now(), LEASE_MS)
      if (!claimed) return last
      const row = await step(claimed, now(), deps)
      last = row.status
      if (isTerminal(row.status)) {
        await finish(row, deps)
        return last
      }
      // A submit that must be retried waits for its backoff (15 s or more): the sweep takes it from there.
      if (row.status === 'pending') return last
      // The row says when it is next due (lifecycle.ts: 2 s after the submit, then 1 s, 2 s, 4 s … 30 s).
      const wait = Math.max(0, new Date(row.nextAttemptAt).getTime() - now()) + 50
      if (now() + wait >= deadline) return last
      await sleep(wait)
    }
    return last
  } catch (err) {
    console.error('[smartbee.follow] failed', JSON.stringify({ documentId: input.documentId, name: (err as Error)?.name ?? null }))
    return last
  }
}

/** After the tap's reply has gone. Outside a request scope (a script, a test) it runs on the next tick. */
export function startSmartbeeFollow(input: { agencyId: number; documentId: number; deps?: FollowDeps }): void {
  const job = () => followSmartbeeDocument(input).then(() => undefined)
  try {
    after(job)
  } catch {
    void Promise.resolve().then(job)
  }
}

export async function sweepSmartbeeDocuments(opts: { deps?: FollowDeps } = {}): Promise<{ advanced: number; notified: number }> {
  const summary = { advanced: 0, notified: 0 }
  const agencies = smartbeeAgencyIds()
  if (!agencies.length) return summary
  const deps = opts.deps ?? {}
  const nowMs = (deps.now ?? Date.now)()

  for (const claimed of await claimDueSmartbeeDocuments(nowMs, agencies, SWEEP_BATCH, LEASE_MS)) {
    if (!isSmartbeeAgency(claimed.agencyId)) continue
    try {
      const row = await step(claimed, nowMs, deps)
      summary.advanced++
      if (isTerminal(row.status)) {
        await finish(row, deps)
        summary.notified++
      }
    } catch (err) {
      console.error('[smartbee.sweep] row failed', JSON.stringify({ documentId: claimed.id, name: (err as Error)?.name ?? null }))
    }
  }
  for (const row of await unnotifiedTerminalDocuments(agencies, nowMs - NOTICE_WINDOW_MS, SWEEP_BATCH)) {
    const r = await notifyOwnerOfSmartbeeDocument({ agencyId: row.agencyId, documentId: row.id, deps: deps.notice }).catch(() => 'error')
    if (r === 'sent' || r === 'unknown' || r === 'rejected') summary.notified++
  }
  return summary
}
