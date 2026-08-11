import {
  claimNotificationJobs,
  completeNotificationJob,
  failNotificationJob,
  reclaimStaleNotificationJobs,
  skipNotificationJob,
  type NotificationJob,
} from '@/db/notifications/jobs'
import { buildRecipientContext } from '@/db/notifications/recipients'
import { leadIdForJob } from './plan'
import { processNotificationJob } from './processJob'

/**
 * The notification worker — spec §3, §21.2.
 *
 * pending → processing (claim) → done | skipped | retried(pending) | dead.
 * Every transition logs with an explicit reason; no job ends silently.
 *
 * Safe to overlap with itself and with after() kicks: claims take a lease with
 * `FOR UPDATE SKIP LOCKED`, so two concurrent passes never touch the same job
 * and neither blocks the other.
 *
 * BATCHED BY CONSTRUCTION: recipient context (lead handlers, agency admins) is
 * loaded ONCE per pass in two queries, before the job loop. No per-notification
 * lookup exists anywhere in this path (spec §21.2).
 */

const LOG = '[notifications][worker]'
/** Matches the automation engine's lease — same failure modes, same recovery. */
const LEASE_MS = 60_000

export type WorkerSummary = { claimed: number; done: number; skipped: number; retried: number; dead: number; created: number }

function logT(transition: string, job: NotificationJob, extra: Record<string, unknown> = {}): void {
  console.log(LOG, {
    transition,
    jobId: job.id,
    type: job.type,
    agencyId: job.agencyId,
    entityType: job.entityType,
    entityId: job.entityId,
    ...extra,
  })
}

/**
 * Everything the pass needs about leads and admins, in two queries.
 *
 * The (agencyId, leadId) pairs are deduplicated first, so twenty jobs about one
 * lead cost one row, and the tuple predicate keeps every lookup tenant-scoped
 * (see db/notifications/recipients.ts).
 */
async function contextForPass(jobs: NotificationJob[]) {
  const pairSeen = new Set<string>()
  const leadPairs: { agencyId: number; leadId: number }[] = []
  const agencyIds = new Set<number>()

  for (const job of jobs) {
    agencyIds.add(job.agencyId)
    const leadId = leadIdForJob(job)
    if (leadId == null) continue
    const key = `${job.agencyId}:${leadId}`
    if (pairSeen.has(key)) continue
    pairSeen.add(key)
    leadPairs.push({ agencyId: job.agencyId, leadId })
  }

  return buildRecipientContext({ leadPairs, agencyIds: Array.from(agencyIds) })
}

export async function runNotificationWorker(opts?: { limit?: number; workerId?: string }): Promise<WorkerSummary> {
  const limit = opts?.limit ?? 10
  const workerId = opts?.workerId ?? `notif-worker-${process.pid}`
  const summary: WorkerSummary = { claimed: 0, done: 0, skipped: 0, retried: 0, dead: 0, created: 0 }

  try {
    const reclaimed = await reclaimStaleNotificationJobs(LEASE_MS)
    if (reclaimed > 0) console.log(LOG, { transition: 'reclaimed', count: reclaimed, reason: 'lease_expired' })

    const jobs = await claimNotificationJobs(workerId, limit)
    summary.claimed = jobs.length
    if (jobs.length === 0) return summary

    const context = await contextForPass(jobs)

    for (const job of jobs) {
      logT('claimed', job, { attempts: job.attempts, workerId })
      try {
        const outcome = await processNotificationJob(job, context)
        if (outcome.kind === 'skipped') {
          await skipNotificationJob(job.id, outcome.reason)
          logT('skipped', job, { reason: outcome.reason })
          summary.skipped++
          continue
        }
        await completeNotificationJob(job.id)
        summary.created += outcome.created
        summary.done++
        logT('done', job, { created: outcome.created })
      } catch (err) {
        // Per-job isolation: one poisoned job must not abandon the rest of the
        // claimed batch, which would leave their leases to expire.
        await failNotificationJob(job.id, String(err))
        const exhausted = job.attempts >= job.maxAttempts
        summary[exhausted ? 'dead' : 'retried']++
        logT(exhausted ? 'dead' : 'retried', job, { reason: String(err), attempts: job.attempts })
      }
    }
  } catch (err) {
    // A pass-level failure (claim query, context load) is logged and swallowed:
    // the cron runs again, and leases expire back to pending.
    console.error(LOG, { transition: 'pass_failed', reason: String(err) })
  }

  console.log(LOG, { transition: 'pass_summary', ...summary, workerId })
  return summary
}
