import { RuntimeScheduler, type SchedulerDeps } from '@/lib/ai/runtime/scheduler'
import { reason as defaultReason } from '@/lib/ai/runtime/reasoning'
import { decide as defaultDecide } from '@/lib/ai/runtime/toolAction'
import { recordCoverageDecision as defaultRecord } from '@/db/ai/shadowCoverage'
import { listResidentLeadSubjects as defaultListResident, listAgenciesWithBeliefs as defaultListAgencies } from '@/db/ai/roster'
import type { Scope } from '@/db/ai/stateManagement'

/**
 * Integration-3 — Continuous Cognition (Tier-1 coverage sweep).
 *
 * This module is the *intelligence*, and it is completely decoupled from any
 * scheduler. `runShadowCoverageSweep` is one idempotent, reusable entry point
 * that ANY trigger can invoke identically — a Vercel cron, GitHub Actions,
 * Trigger.dev, cron-job.org, AWS EventBridge, a future internal scheduler, or a
 * developer running it by hand. It knows nothing about HTTP, cron semantics, or
 * any host API. Changing the scheduler requires changing zero code here.
 *
 * On invocation it activates M4's Tier-1 coverage sweep as a production
 * capability, in shadow: per canary agency it seeds the Scheduler from the
 * resident roster, sweeps (coverage + staleness re-attention — thinking without
 * waiting for a message), and runs the read spine per relationship
 * (M4 sweep → M5 reason → M6 decide) into the isolated coverage sink. Read-only:
 * it takes no action, sends nothing, and surfaces nothing to any operator.
 *
 * Safe by construction: feature-flagged per-agency (default OFF), fully guarded
 * per agency and per relationship (one failure never aborts the sweep), bounded
 * per run (excess relationships roll to the next sweep — coverage as membership,
 * not simultaneity — with the deferred count logged, never silently dropped), and
 * idempotent per sweep window. It reuses M4/M5/M6 through their public contracts
 * only; no runtime module is modified.
 */

export interface CoverageSweepDeps {
  listResidentLeadSubjects?: typeof defaultListResident
  listAgenciesWithBeliefs?: typeof defaultListAgencies
  listStaleBeliefs?: SchedulerDeps['listStaleBeliefs']
  reason?: typeof defaultReason
  decide?: typeof defaultDecide
  record?: typeof defaultRecord
}

export interface RunCoverageSweepOptions {
  now?: Date
  /** Max relationships processed per agency per run (the rest roll to the next sweep). */
  maxPerSweep?: number
  /** The sweep-window size for the idempotency bucket. */
  bucketMs?: number
  /** Explicit agencies to sweep — bypasses the env flag (local dev / tests). */
  agencyIds?: number[]
  deps?: CoverageSweepDeps
}

export interface CoverageSweepSummary {
  agencies: number
  swept: number
  decisions: number
  deferred: number
  errored: number
}

const DEFAULT_MAX_PER_SWEEP = 200
const DEFAULT_BUCKET_MS = 60 * 60 * 1000

/**
 * Per-agency canary flag, default OFF. Empty/unset allowlist → off everywhere.
 * `SHADOW_COVERAGE_KILL=1` is the global backstop. Independent of the other flags.
 */
export function isShadowCoverageEnabled(agencyId: number | null | undefined): boolean {
  const kill = process.env.SHADOW_COVERAGE_KILL
  if (kill === '1' || kill === 'true') return false
  const raw = (process.env.SHADOW_COVERAGE_AGENCY_IDS ?? '').trim()
  if (!raw) return false
  if (raw === 'all') return true
  if (!agencyId) return false
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .includes(agencyId)
}

/** Resolve which agencies to sweep: an explicit override, else the env canary set. */
async function resolveAgencies(opts: RunCoverageSweepOptions, listAgencies: typeof defaultListAgencies): Promise<number[]> {
  if (opts.agencyIds && opts.agencyIds.length > 0) return opts.agencyIds
  const kill = process.env.SHADOW_COVERAGE_KILL
  if (kill === '1' || kill === 'true') return []
  const raw = (process.env.SHADOW_COVERAGE_AGENCY_IDS ?? '').trim()
  if (!raw) return []
  if (raw === 'all') return listAgencies()
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0)
}

/**
 * Run one coverage sweep across the canary agencies. Idempotent, guarded,
 * scheduler-agnostic. Never throws; always returns a summary.
 */
export async function runShadowCoverageSweep(opts: RunCoverageSweepOptions = {}): Promise<CoverageSweepSummary> {
  const now = opts.now ?? new Date()
  const maxPerSweep = opts.maxPerSweep ?? DEFAULT_MAX_PER_SWEEP
  const bucketMs = opts.bucketMs ?? DEFAULT_BUCKET_MS
  const sweepBucket = Math.floor(now.getTime() / bucketMs)
  const deps = opts.deps ?? {}
  const listResident = deps.listResidentLeadSubjects ?? defaultListResident
  const listAgencies = deps.listAgenciesWithBeliefs ?? defaultListAgencies
  const reason = deps.reason ?? defaultReason
  const decide = deps.decide ?? defaultDecide
  const record = deps.record ?? defaultRecord

  const summary: CoverageSweepSummary = { agencies: 0, swept: 0, decisions: 0, deferred: 0, errored: 0 }

  let agencies: number[]
  try {
    agencies = await resolveAgencies(opts, listAgencies)
  } catch (err) {
    console.error('[shadow-coverage] agency resolution failed:', (err as Error).message)
    return summary
  }

  for (const agencyId of agencies) {
    try {
      const scope: Scope = { agencyId }
      const roster = await listResident(scope)
      const scheduler = new RuntimeScheduler(scope, deps.listStaleBeliefs ? { listStaleBeliefs: deps.listStaleBeliefs } : {})
      scheduler.seed(roster)
      const result = await scheduler.sweep({ now })

      // Staleness re-attention first (most-overdue), then coverage. Time-based
      // fairness, never a ranking of business value.
      const staleness = result.requests.filter((r) => r.reason === 'staleness')
      const coverage = result.requests.filter((r) => r.reason === 'coverage_sweep')
      const ordered = [...staleness, ...coverage]
      const toProcess = ordered.slice(0, maxPerSweep)
      const deferred = ordered.length - toProcess.length
      summary.agencies += 1
      summary.deferred += deferred
      if (deferred > 0) {
        console.log(`[shadow-coverage] agency=${agencyId} deferred ${deferred}/${ordered.length} to next sweep`)
      }

      for (const request of toProcess) {
        try {
          const understanding = await reason(request, { now })
          const decision = decide(understanding, { scope, now })
          summary.swept += 1
          await record({
            agencyId,
            subjectType: request.subject.subjectType,
            subjectId: request.subject.subjectId,
            reason: request.reason === 'staleness' ? 'staleness' : 'coverage_sweep',
            outcome: decision.emitted ? decision.outcome : 'rejected',
            emitted: decision.emitted,
            rejectionBoundary: 'rejection' in decision ? decision.rejection.boundary : null,
            decision,
            sweptAt: result.sweptAt,
            sweepBucket,
          })
          summary.decisions += 1
        } catch (reqErr) {
          summary.errored += 1
          console.error(`[shadow-coverage] agency=${agencyId} subject=${request.subject.subjectId}:`, (reqErr as Error).message)
        }
      }
    } catch (agencyErr) {
      summary.errored += 1
      console.error(`[shadow-coverage] agency=${agencyId}:`, (agencyErr as Error).message)
    }
  }
  return summary
}
