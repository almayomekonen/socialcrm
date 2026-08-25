import { runSignalSweep, resolveSweepAgencies, type RunSignalSweepOptions, type SignalSweepSummary } from './signalSweep'
import { runSignalWorker, isSignalWorkerKilled, type RunSignalWorkerOptions, type SignalWorkerSummary } from './signalWorker'

/**
 * The signal tick — THE production execution path, and the only one.
 *
 * One invocation does two bounded things in order:
 *
 *   1. PRODUCE — `runSignalSweep` evaluates the detectors over the allowlisted
 *      agencies' CRM state and enqueues what it finds into `signal_jobs`.
 *   2. DRAIN  — `runSignalWorker` claims leased batches and runs each through
 *      the ratified runtime (M3 → M4 → M5 → M6) into `ai_shadow_coverage`.
 *
 * The two halves are deliberately NOT one loop. Producing is idempotent and
 * cheap; draining is leased, retried and bounded by a wall clock. Coupling them
 * would mean a slow drain delaying detection, and a failed detection stranding
 * a queue that could have been drained. The queue is the seam, and Postgres —
 * not this function, and not Vercel — is what makes the work durable.
 *
 * OVERLAP IS SAFE BY CONSTRUCTION, not by locking. Two ticks running at once
 * produce the same observation keys, and `ON CONFLICT DO NOTHING` collapses
 * them; they claim from the same queue, and `FOR UPDATE SKIP LOCKED` partitions
 * it. Neither half needs to know the other is running. There is no advisory
 * lock here, and adding one would trade a real guarantee for a coarser one.
 *
 * DISABLED MEANS DISABLED. When no agency is allowlisted — or either kill
 * switch is set — the tick does no work at all: it does not read the CRM, does
 * not claim, and touches no table. That is stricter than the worker's own
 * policy on purpose. `runSignalWorker` deliberately carries no allowlist so an
 * operator can still drain by hand after an agency leaves the canary; the TICK
 * is the scheduled path, and a scheduled path must go completely quiet when the
 * integration is off.
 *
 * SCHEDULER-AGNOSTIC. This function knows nothing about HTTP, cron semantics, or
 * any host API — exactly like `runShadowCoverageSweep` beside it. Vercel Cron is
 * a wake-up call; the same tick runs identically from a script, a different
 * scheduler, or a developer's shell.
 */

export interface SignalTickSummary {
  /** True when the integration is off for every agency — nothing was touched. */
  skipped: boolean
  agencies: number
  sweep: SignalSweepSummary
  worker: SignalWorkerSummary
}

export interface RunSignalTickOptions {
  now?: Date
  sweep?: Omit<RunSignalSweepOptions, 'now'>
  worker?: Omit<RunSignalWorkerOptions, 'now'>
  /** Explicit agencies — bypasses the env flag (local dev / tests). */
  agencyIds?: number[]
}

const EMPTY_SWEEP: SignalSweepSummary = {
  agencies: 0,
  detected: 0,
  enqueued: 0,
  duplicates: 0,
  refused: 0,
  deferred: 0,
  errored: 0,
}
const EMPTY_WORKER: SignalWorkerSummary = {
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

/**
 * Run one tick. Never throws; always returns a summary. Both halves are already
 * guarded internally, so a failure in either is reported rather than raised.
 */
export async function runSignalTick(opts: RunSignalTickOptions = {}): Promise<SignalTickSummary> {
  const now = opts.now ?? new Date()
  const agencyIds = opts.agencyIds ?? opts.sweep?.agencyIds

  // The gate, evaluated once, before any I/O. An empty allowlist, a refused
  // 'all', or SIGNAL_SWEEP_KILL all resolve to an empty set here.
  const agencies = resolveSweepAgencies({ agencyIds })
  if (agencies.length === 0 || isSignalWorkerKilled()) {
    return { skipped: true, agencies: 0, sweep: EMPTY_SWEEP, worker: EMPTY_WORKER }
  }

  const sweep = await runSignalSweep({ ...opts.sweep, agencyIds: agencies, now })
  const worker = await runSignalWorker({ ...opts.worker, now })

  return { skipped: false, agencies: agencies.length, sweep, worker }
}
