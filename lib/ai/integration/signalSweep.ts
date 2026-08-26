import { enqueueSignal as defaultEnqueue, type EnqueueResult } from '@/db/ai/signalJobs'
import { listAgencyLeadFacts as defaultListFacts } from '@/db/ai/leadFacts'
import {
  listAgencyConversationFacts as defaultListConversationFacts,
  NO_CONVERSATION_FACTS,
} from '@/db/ai/conversationFacts'
import { businessDayBounds } from '@/lib/today/time'
import { DETECTOR_LIST } from './detectors/registry'
import type { Scope } from '@/db/ai/stateManagement'

/**
 * The signal PRODUCER — detect, and enqueue. Nothing else.
 *
 * Phase 1 proved the chain by running it inline: this module detected AND
 * interpreted AND admitted AND reasoned AND decided AND recorded, in one
 * function call. That was the right shape for a proof and the wrong shape for
 * production, and leaving it in place after Phase 2 would have been worse than
 * either — TWO production paths reaching the runtime, one durable and one not,
 * disagreeing the first time a function invocation died halfway.
 *
 * So the inline path is gone. There is exactly one production path now:
 *
 *   runSignalSweep()  → detect → enqueueSignal → signal_jobs
 *   runSignalWorker() → claim → M3 → M4 → M5 → M6 → ai_shadow_coverage
 *
 * and lib/ai/integration/signalTick.ts is the single entry point that runs them
 * in order. This module ends at the queue. It does not import `interpret`,
 * `RuntimeScheduler`, `reason`, `decide` or the coverage sink, and a test
 * asserts that it does not — that absence IS the "one path" guarantee.
 *
 * WHAT DID NOT CHANGE. Detection semantics are untouched: the same registry,
 * the same `classifyLead` delegation, the same terminal exclusion, the same
 * business-day bounds from `lib/today/time.ts`, the same per-agency allowlist
 * and kill switch, the same refusal of `'all'`, the same guarding and bounding.
 * A signal this module emits today is byte-identical to the one Phase 1 emitted.
 *
 * IDEMPOTENCE IS THE QUEUE'S, NOT THIS MODULE'S. `enqueueSignal` is
 * `ON CONFLICT DO NOTHING` on a deterministic observation key, so a sweep may
 * run every minute forever and a still-overdue follow-up produces one job. This
 * module therefore needs no memory of its previous run, and two overlapping
 * cron invocations are safe by construction rather than by locking.
 */

export interface SignalSweepDeps {
  listAgencyLeadFacts?: typeof defaultListFacts
  /**
   * The qualifier's persisted turn classifications, for the conversation-sourced
   * detectors. Injected like every other dependency so the sweep stays testable
   * without a database; a failure to read them degrades to
   * `NO_CONVERSATION_FACTS` rather than losing the lead-state detectors.
   */
  listAgencyConversationFacts?: typeof defaultListConversationFacts
  enqueueSignal?: typeof defaultEnqueue
}

export interface RunSignalSweepOptions {
  now?: Date
  /** Max signals enqueued per agency per run (the rest roll to the next sweep). */
  maxPerSweep?: number
  /** Explicit agencies to sweep — bypasses the env flag (local dev / tests). */
  agencyIds?: number[]
  deps?: SignalSweepDeps
}

export interface SignalSweepSummary {
  agencies: number
  /** Signals the detectors emitted. */
  detected: number
  /** New jobs created. */
  enqueued: number
  /** Observations already known — a no-op, and the expected steady state. */
  duplicates: number
  /** Signals the ingress refused at the queue door, or that could not be identified. */
  refused: number
  /** Signals rolled to the next sweep by the per-run bound. */
  deferred: number
  errored: number
}

const DEFAULT_MAX_PER_SWEEP = 200

/**
 * Per-agency canary flag, default OFF. Empty/unset allowlist → off everywhere.
 * `SIGNAL_SWEEP_KILL=1` is the global backstop. Independent of the shadow flags,
 * so this can be killed while shadow ingest/cognition/coverage continue.
 *
 * Unlike its siblings there is deliberately NO `'all'` value. Those sweep the
 * runtime's own resident beliefs; this one reads the production CRM, and an
 * accidental `all` would put every tenant's leads through cognition. A canary
 * that can be widened by a typo is not a canary.
 */
export function isSignalSweepEnabled(agencyId: number | null | undefined): boolean {
  const kill = process.env.SIGNAL_SWEEP_KILL
  if (kill === '1' || kill === 'true') return false
  const raw = (process.env.SIGNAL_SWEEP_AGENCY_IDS ?? '').trim()
  if (!raw) return false
  if (!agencyId) return false
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .includes(agencyId)
}

/**
 * Resolve which agencies to sweep: an explicit override, else the env canary
 * set. The agency NEVER comes from a request — this is the only place the set is
 * decided, and its only inputs are the environment and a local/test override.
 */
export function resolveSweepAgencies(opts: Pick<RunSignalSweepOptions, 'agencyIds'> = {}): number[] {
  // The kill switch is checked FIRST, before the override. An explicit
  // `agencyIds` is a local/dev affordance for bypassing the ALLOWLIST; a kill
  // switch a caller can step around is not a kill switch, and "stop everything
  // now" must hold for every caller, including this one.
  const kill = process.env.SIGNAL_SWEEP_KILL
  if (kill === '1' || kill === 'true') return []
  if (opts.agencyIds && opts.agencyIds.length > 0) return opts.agencyIds
  const raw = (process.env.SIGNAL_SWEEP_AGENCY_IDS ?? '').trim()
  if (!raw) return []
  if (raw === 'all') {
    console.warn(`[signal-sweep] SIGNAL_SWEEP_AGENCY_IDS='all' is refused; list agency ids explicitly`)
    return []
  }
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0)
}

/**
 * Run one detection sweep across the canary agencies and enqueue what it finds.
 * Guarded, scheduler-agnostic, idempotent. Never throws; always returns a summary.
 */
export async function runSignalSweep(opts: RunSignalSweepOptions = {}): Promise<SignalSweepSummary> {
  const now = opts.now ?? new Date()
  const maxPerSweep = opts.maxPerSweep ?? DEFAULT_MAX_PER_SWEEP
  const ctx = businessDayBounds(now.getTime())

  const deps = opts.deps ?? {}
  const listFacts = deps.listAgencyLeadFacts ?? defaultListFacts
  const listConversationFacts = deps.listAgencyConversationFacts ?? defaultListConversationFacts
  const enqueue = deps.enqueueSignal ?? defaultEnqueue

  const summary: SignalSweepSummary = {
    agencies: 0,
    detected: 0,
    enqueued: 0,
    duplicates: 0,
    refused: 0,
    deferred: 0,
    errored: 0,
  }

  for (const agencyId of resolveSweepAgencies(opts)) {
    try {
      const scope: Scope = { agencyId }
      const facts = await listFacts(scope)

      /**
       * Conversation facts are ADDITIVE, so their failure must be too. A broken
       * classification read costs the three conversation detectors their input;
       * it must never cost `followup.overdue` and `sla.open_loop` a sweep they
       * would otherwise have completed. Degrading to the empty set makes those
       * detectors emit nothing, which is exactly what they would emit anyway.
       */
      let conversation = NO_CONVERSATION_FACTS
      try {
        conversation = await listConversationFacts(scope, now.getTime())
      } catch (convErr) {
        console.error(`[signal-sweep] agency=${agencyId} conversation facts unavailable:`, (convErr as Error).message)
      }

      // Detection. Pure, per registry entry, no ranking applied to the union.
      const signals = DETECTOR_LIST.flatMap((d) => d.detect(facts, ctx, scope, conversation))
      summary.agencies += 1
      summary.detected += signals.length

      const toEnqueue = signals.slice(0, maxPerSweep)
      const deferred = signals.length - toEnqueue.length
      summary.deferred += deferred
      if (deferred > 0) {
        console.log(`[signal-sweep] agency=${agencyId} deferred ${deferred}/${signals.length} to next sweep`)
      }

      for (const signal of toEnqueue) {
        try {
          const result: EnqueueResult = await enqueue(signal)
          if (result.enqueued === true) {
            summary.enqueued += 1
            continue
          }
          if (result.reason === 'duplicate') {
            summary.duplicates += 1
            continue
          }
          summary.refused += 1
          console.log(
            `[signal-sweep] agency=${agencyId} subject=${signal.subject?.subjectId ?? '-'} refused=${result.reason}:${result.detail}`,
          )
        } catch (signalErr) {
          summary.errored += 1
          console.error(
            `[signal-sweep] agency=${agencyId} subject=${signal.subject?.subjectId ?? '-'}:`,
            (signalErr as Error).message,
          )
        }
      }
    } catch (agencyErr) {
      summary.errored += 1
      console.error(`[signal-sweep] agency=${agencyId}:`, (agencyErr as Error).message)
    }
  }

  return summary
}
