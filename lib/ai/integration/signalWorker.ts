import {
  claimSignalJobs as defaultClaim,
  succeedSignalJob as defaultSucceed,
  failSignalJob as defaultFail,
  deadLetterSignalJob as defaultDeadLetter,
  reclaimStaleSignalJobs as defaultReclaim,
  type SignalJob,
} from '@/db/ai/signalJobs'
import { interpret as defaultInterpret } from '@/lib/ai/runtime/eventInterpretation'
import { RuntimeScheduler, type AdmissionReason } from '@/lib/ai/runtime/scheduler'
import { reason as defaultReason } from '@/lib/ai/runtime/reasoning'
import { decide as defaultDecide } from '@/lib/ai/runtime/toolAction'
import { recordCoverageDecision as defaultRecord, type CoverageReason } from '@/db/ai/shadowCoverage'
import { releaseSignalJobClaim as defaultReleaseClaim } from '@/db/ai/signalJobs'
import { admitInvestigation as defaultAdmit, reclaimExpiredReservations } from './investigationAdmission'
import { isInvestigationEnabled } from './investigationFlags'
import type { Scope } from '@/db/ai/stateManagement'

/**
 * The signal worker — one bounded drain of `signal_jobs`.
 *
 * Phase 1 detected and processed in one pass. This drains what was durably
 * enqueued instead, and processes it through the SAME ratified path, unchanged:
 *
 *   claim (lease) → interpret() (M3) → RuntimeScheduler.admit() (M4)
 *   → reason() (M5) → decide() (M6) → ai_shadow_coverage → succeed
 *
 * There is no second scheduler and no second signal model. The worker owns
 * exactly one thing the runtime does not: what to do when a pass FAILS.
 *
 * RETRYABLE VS TERMINAL. A thrown error is assumed transient — a database blip,
 * a lost connection — so the job returns to `pending` behind a backoff until its
 * attempts are spent. One failure is NOT transient and is dead-lettered
 * immediately: a stored signal the ingress refuses. That row will be refused
 * identically on every future attempt, so retrying it is pure waste, and letting
 * it consume three attempts would hide a real corruption behind a slow death.
 *
 * THE STORED SIGNAL IS UNTRUSTED. `enqueueSignal` already ran M3 at the door, and
 * the worker runs it again on claim. A row is bytes read back from a database by
 * the time the worker sees it, and the fabrication ban is worth paying for twice.
 *
 * ZERO MODEL CALLS. Nothing here, in the substrate, or in M3/M4/M5/M6 imports a
 * provider. NO NOTIFICATIONS: nothing here imports or writes the notification
 * lifecycle — recipient resolution belongs to that engine, later, and inventing
 * it here would put permission fan-out on a queue worker. NO CRM WRITES: the
 * only tables touched are `signal_jobs` (its own lifecycle) and the isolated
 * `ai_shadow_coverage` audit sink.
 *
 * NOTE ON SIZE (architecture-rules.md §6): ~272 lines, over the 250 soft limit
 * and intentionally so. A third of it is this header, and the body is one
 * concern — drain the queue once — as a budget loop around a per-job pass.
 * Splitting the per-job pass into its own file would separate the retry
 * decision from the loop that bounds it, which is exactly the pairing a
 * reader needs to hold at once. The extraction trigger is a second drain
 * shape (parallel workers, per-agency partitioning), not another verb.
 *
 * SAFE BY CONSTRUCTION: guarded per job so one failure never aborts a drain,
 * bounded per invocation, never throwing across its own boundary, and idempotent
 * per sweep window at the sink. `SIGNAL_WORKER_KILL=1` halts it globally.
 *
 * WHY NO PER-AGENCY ALLOWLIST HERE. Its three siblings gate the agencies they
 * READ. This worker reads only rows that a gated producer already wrote, so an
 * allowlist would add nothing at the door and would silently strand legitimately
 * enqueued work when an agency left the canary. The kill switch remains, because
 * "stop everything now" must not depend on a list being correct.
 */

export interface SignalWorkerDeps {
  claim?: typeof defaultClaim
  succeed?: typeof defaultSucceed
  fail?: typeof defaultFail
  deadLetter?: typeof defaultDeadLetter
  reclaim?: typeof defaultReclaim
  interpret?: typeof defaultInterpret
  reason?: typeof defaultReason
  decide?: typeof defaultDecide
  record?: typeof defaultRecord
  releaseClaim?: typeof defaultReleaseClaim
  admitInvestigation?: typeof defaultAdmit
}

export interface RunSignalWorkerOptions {
  now?: Date
  /** Max jobs processed per invocation. The rest wait for the next drain. */
  limit?: number
  /**
   * Wall-clock budget for the whole drain. Checked BEFORE each batch is
   * claimed, never mid-batch: a job that has been leased is always processed,
   * so the budget can never strand a lease it just took. The overshoot is
   * therefore bounded by one batch, not by the queue depth.
   */
  budgetMs?: number
  /** Jobs leased per claim round inside the budget loop. */
  batchSize?: number
  /** Lease lifetime; a job held longer than this is reclaimed. */
  leaseMs?: number
  /** The sweep-window size for the sink's idempotency bucket. */
  bucketMs?: number
  workerId?: string
  /**
   * Wall-clock for the AUTONOMOUS phase, checked before each investigation and
   * never mid-call. Separate from `budgetMs` so a slow model can never eat the
   * deterministic drain, and so the two together stay inside maxDuration.
   */
  investigateBudgetMs?: number
  deps?: SignalWorkerDeps
}

export interface SignalWorkerSummary {
  /** Leases recovered from workers that died holding them. */
  reclaimed: number
  /** Claim rounds performed inside the budget. */
  batches: number
  claimed: number
  succeeded: number
  /** Retryable failures returned to the queue (or dead-lettered on the last attempt). */
  failed: number
  /** Terminal failures: a stored signal the ingress refuses. */
  deadLettered: number
  /** Decisions persisted to the coverage sink. */
  decisions: number
  /** Admission reasons the sink's vocabulary cannot express — never mislabelled. */
  unrepresentable: number
  /** True when the drain stopped on its time budget with work still queued. */
  budgetExhausted: boolean
  /** Jobs taken by the autonomous path instead of the deterministic one. */
  investigated: number
  /** Autonomous runs that produced a surfaceable Recommend (recorded, not delivered). */
  recommended: number
  /** Claims released without consuming an attempt (capacity, never failure). */
  capacityDeferred: number
  /** Expired budget holds reclaimed at the start of the pass. */
  reservationsReclaimed: number
}

const DEFAULT_LIMIT = 25
const DEFAULT_BATCH_SIZE = 5
/**
 * Default wall-clock budget. The cron route caps at `maxDuration = 60`, so the
 * drain stops well short of it and leaves room for the response — a function
 * killed mid-write is exactly the failure the lease exists to survive, but not
 * one worth arranging on every tick.
 */
/**
 * Re-carved in Phase 4.3. The deterministic drain drops from 45s so the tick can
 * also afford ONE autonomous investigation and still finish inside the cron's
 * maxDuration = 60:
 *
 *   produce ~2s + drain 20s + investigate 25s = ~47s worst case.
 *
 * The Agent's own global defaults are untouched; the autonomous call is bounded
 * per-invocation instead (AUTONOMOUS_DEADLINE_MS / AUTONOMOUS_MAX_STEPS).
 */
const DEFAULT_BUDGET_MS = 20_000
const DEFAULT_INVESTIGATE_BUDGET_MS = 25_000
const DEFAULT_LEASE_MS = 5 * 60 * 1000
const DEFAULT_BUCKET_MS = 60 * 60 * 1000

/** Mirrors the CHECK on `ai_shadow_coverage.reason`. Never coerce; count and skip. */
const SINK_REASONS: ReadonlySet<string> = new Set<CoverageReason>(['coverage_sweep', 'staleness', 'absence'])

function toSinkReason(reason: AdmissionReason): CoverageReason | null {
  return SINK_REASONS.has(reason) ? (reason as CoverageReason) : null
}

/** The global backstop. There is no allowlist here — see the module header. */
export function isSignalWorkerKilled(): boolean {
  const kill = process.env.SIGNAL_WORKER_KILL
  return kill === '1' || kill === 'true'
}

/**
 * Run one drain. Never throws; always returns a summary.
 *
 * One scheduler per AGENCY, not per job: membership grows monotonically across
 * the jobs of one tenant, and an event for another tenant is dropped by M4's own
 * scope check even if a row somehow carried one.
 */
export async function runSignalWorker(opts: RunSignalWorkerOptions = {}): Promise<SignalWorkerSummary> {
  const summary: SignalWorkerSummary = {
    reclaimed: 0,
    batches: 0,
    claimed: 0,
    succeeded: 0,
    failed: 0,
    deadLettered: 0,
    decisions: 0,
    unrepresentable: 0,
    budgetExhausted: false,
    investigated: 0,
    recommended: 0,
    capacityDeferred: 0,
    reservationsReclaimed: 0,
  }
  if (isSignalWorkerKilled()) return summary

  const now = opts.now ?? new Date()
  const limit = opts.limit ?? DEFAULT_LIMIT
  const batchSize = Math.max(1, opts.batchSize ?? DEFAULT_BATCH_SIZE)
  const budgetMs = opts.budgetMs ?? DEFAULT_BUDGET_MS
  const startedAt = Date.now()
  const deadline = startedAt + budgetMs
  const leaseMs = opts.leaseMs ?? DEFAULT_LEASE_MS
  const bucketMs = opts.bucketMs ?? DEFAULT_BUCKET_MS
  const sweptAt = now.toISOString()
  const sweepBucket = Math.floor(now.getTime() / bucketMs)
  const workerId = opts.workerId ?? `signal-worker-${process.pid}`

  const deps = opts.deps ?? {}
  const claim = deps.claim ?? defaultClaim
  const succeed = deps.succeed ?? defaultSucceed
  const fail = deps.fail ?? defaultFail
  const deadLetter = deps.deadLetter ?? defaultDeadLetter
  const reclaim = deps.reclaim ?? defaultReclaim
  const interpret = deps.interpret ?? defaultInterpret
  const reason = deps.reason ?? defaultReason
  const decide = deps.decide ?? defaultDecide
  const record = deps.record ?? defaultRecord
  const releaseClaim = deps.releaseClaim ?? defaultReleaseClaim
  const admitInvestigation = deps.admitInvestigation ?? defaultAdmit
  const investigateBudgetMs = opts.investigateBudgetMs ?? DEFAULT_INVESTIGATE_BUDGET_MS
  const investigateDeadline = startedAt + budgetMs + investigateBudgetMs
  // Subjects an investigation has already taken this pass. One investigation per
  // SUBJECT, never per signal (P2 coalescing).
  const claimedSubjects = new Set<string>()

  // Expired budget holds are reclaimed on the same clock as expired leases: a
  // lambda killed mid-investigation must not strand money any more than it may
  // strand a job.
  try {
    summary.reservationsReclaimed = await reclaimExpiredReservations(now)
  } catch (err) {
    console.error('[signal-worker] reservation reclaim failed:', (err as Error).message)
  }

  try {
    summary.reclaimed = await reclaim(leaseMs)
  } catch (err) {
    console.error('[signal-worker] reclaim failed:', (err as Error).message)
    return summary
  }

  const schedulers = new Map<number, RuntimeScheduler>()
  const schedulerFor = (scope: Scope): RuntimeScheduler => {
    const existing = schedulers.get(scope.agencyId)
    if (existing) return existing
    const created = new RuntimeScheduler(scope)
    schedulers.set(scope.agencyId, created)
    return created
  }

  // The budget loop. Claiming happens in small batches so the wall-clock check
  // sits BETWEEN claims: a leased job is always processed in the same
  // invocation that leased it, and the overshoot past the deadline is bounded
  // by one batch rather than by the depth of the queue.
  while (summary.claimed < limit) {
    if (Date.now() >= deadline) {
      summary.budgetExhausted = true
      console.log(
        `[signal-worker] budget of ${budgetMs}ms spent after ${summary.claimed} job(s); the rest wait for the next tick`,
      )
      break
    }

    let jobs: SignalJob[] = []
    try {
      jobs = await claim(workerId, Math.min(batchSize, limit - summary.claimed))
    } catch (err) {
      console.error('[signal-worker] claim failed:', (err as Error).message)
      break
    }
    if (jobs.length === 0) break
    summary.batches += 1
    summary.claimed += jobs.length

    for (const job of jobs) {
      const scope: Scope = { agencyId: job.agencyId }
      try {
        // M3 again, on bytes read back from storage.
        const interpreted = interpret(job.signal)
        if (interpreted.accepted === false) {
          await deadLetter(job.id, `ingress-refused:${interpreted.rejection.code}`)
          summary.deadLettered += 1
          console.log(`[signal-worker] job=${job.id} agency=${job.agencyId} dead: ${interpreted.rejection.code}`)
          continue
        }

        // ── The autonomous branch. A job takes EXACTLY ONE path. ────────────
        //
        // Gated twice over: the agency must be allowlisted for investigation, and
        // the pass must still have autonomous wall-clock left. When either is
        // false the job falls through to the deterministic path below, exactly as
        // it behaved before Phase 4.3 — which is what keeps production dark while
        // the flag is unset.
        if (isInvestigationEnabled(job.agencyId) && Date.now() < investigateDeadline) {
          const verdict = await admitInvestigation(job, {
            now,
            leaseMs,
            claimedSubjects,
            sweepBucket,
          })

          if (verdict.jobDisposition === 'leave_pending') {
            // CAPACITY, not failure. Nothing was examined, so the attempt the
            // claim consumed is given back and the job waits for the next tick.
            await releaseClaim(job.id)
            summary.capacityDeferred += 1
            console.log(`[signal-worker] job=${job.id} deferred: ${verdict.detail}`)
            continue
          }

          summary.investigated += 1
          if (verdict.outcome === 'recommended') summary.recommended += 1
          if (verdict.outcome !== 'declined_precondition') claimedSubjects.add(job.subjectId)

          if (verdict.jobDisposition === 'fail') {
            summary.failed += 1
            await fail(job.id, verdict.detail)
            continue
          }

          // A precondition decline means the autonomous path examined nothing and
          // is not the owner of this observation; the deterministic pass below is.
          // Every other judgement is terminal and the job is finished here.
          if (verdict.outcome !== 'declined_precondition') {
            await succeed(job.id)
            summary.succeeded += 1
            continue
          }
        }

        // M4 — admission. Tier and reason are the scheduler's to decide.
        const requests = schedulerFor(scope).admit(interpreted.event, { now })

        for (const request of requests) {
          const sinkReason = toSinkReason(request.reason)
          if (sinkReason === null) {
            summary.unrepresentable += 1
            console.log(
              `[signal-worker] job=${job.id} reason='${request.reason}' not representable in ai_shadow_coverage; not persisted`,
            )
            continue
          }

          // M5 → M6. Deterministic: no provider is reachable from either.
          const understanding = await reason(request, { now })
          const decision = decide(understanding, { scope, now })

          await record({
            agencyId: job.agencyId,
            subjectType: request.subject.subjectType,
            subjectId: request.subject.subjectId,
            reason: sinkReason,
            outcome: decision.emitted ? decision.outcome : 'rejected',
            emitted: decision.emitted,
            rejectionBoundary: 'rejection' in decision ? decision.rejection.boundary : null,
            decision,
            sweptAt,
            sweepBucket,
          })
          summary.decisions += 1
        }

        // An admitted-nothing job is still processed: the observation was seen and
        // the runtime had nothing to bring into cognition. That is a success, not
        // a failure to retry.
        await succeed(job.id)
        summary.succeeded += 1
      } catch (jobErr) {
        summary.failed += 1
        const message = (jobErr as Error).message
        console.error(`[signal-worker] job=${job.id} agency=${job.agencyId}:`, message)
        try {
          await fail(job.id, message)
        } catch (failErr) {
          console.error(`[signal-worker] job=${job.id} could not be marked failed:`, (failErr as Error).message)
        }
      }
    }
  }

  return summary
}
