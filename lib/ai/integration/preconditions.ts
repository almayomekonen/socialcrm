import { classifyLead } from '@/lib/today/classify'
import { businessDayBounds } from '@/lib/today/time'
import { isOwnedByDeterministicNotification, vigilanceClassFor } from './notificationOwnership'
import { readLeadFact as defaultReadLeadFact } from '@/db/ai/leadFacts'
import { lastReservationForSubject as defaultLastReservation } from '@/db/ai/spendReservations'
import { resolveAutonomousScope as defaultResolveScope } from './autonomousScope'
import type { ExpectationKind } from './detectors/registry'
import type { SignalJob } from '@/db/ai/signalJobs'
import type { QualifyingState } from '@/lib/today/types'
import type { AgentScope } from '@/lib/agent/types'
import type { ValueContext } from '@/lib/ai/runtime/valueBar'

/**
 * The deterministic precondition re-check — everything that must be true
 * immediately before an investigation, and nothing that costs a token.
 *
 * A signal was detected at some earlier instant and has been sitting in a queue.
 * By the time a worker claims it the world has moved: the lead may have been
 * called, the follow-up rescheduled, the lead closed, the rep reassigned. Spending
 * a model call to discover that is the most expensive way to learn it.
 *
 * ORDERED CHEAPEST-FIRST, AND NOTHING IS RESERVED UNTIL ALL OF THEM PASS. P1 costs
 * nothing at all; P2–P5 each cost one query; the reservation comes after. That
 * ordering is not an optimisation, it is the reason Phase 4.2 can be run against
 * production data at zero cost: with `followup.overdue` owned by a deterministic
 * notification type, P1 declines every signal that exists today before a single
 * row is written.
 *
 * NO BUSINESS STATE IS RE-DERIVED HERE. `classifyLead` is the sole classifier —
 * it already evaluates STATE_PRIORITY in order and already returns null for a
 * terminal lead, so "is this still true" and "is this lead still live" are one
 * question with one authority. A hand-rolled `nextFollowUpAt < dayStart` would
 * have answered differently for a lead that is now WAITING_REPLY, which is exactly
 * the bug the detector's own header warns about.
 *
 * EVERY OUTCOME IS A JUDGEMENT, NEVER A TRANSPORT FAILURE. A precondition that
 * declines is not an error and must never be retried: the fact it observed will be
 * just as true on the next tick. The caller marks such a job SUCCEEDED — the
 * observation was examined and correctly produced nothing.
 */

export type PreconditionCode =
  /** P1 — a deterministic notification type already delivers this fact (DA-001 §13). */
  | 'owned_by_deterministic_notification'
  /** P2 — another job for this subject is already being handled this pass. */
  | 'coalesced_into_sibling'
  /** P3 — this subject was looked at inside the refractory window. */
  | 'within_refractory_window'
  /** P4 — the lead is gone, terminal, or no longer in the expected state. */
  | 'state_no_longer_holds'
  /** P5 — nobody can act on it, or the agency is not entitled. */
  | 'no_operator'

export type PreconditionResult =
  | {
      proceed: true
      scope: AgentScope
      state: QualifyingState
      operatorUserId: number
      /**
       * The Value Bar's deterministic input, assembled from the SAME facts these
       * preconditions just verified.
       *
       * Built here rather than at the gate on purpose: `state` is P4's
       * `classifyLead` result and `ownedByDeterministicNotification` is P1's
       * answer, so deriving them a second time downstream would be a second
       * derivation of facts that were established once — the exact drift the
       * single-authority rule exists to prevent.
       */
      value: ValueContext
    }
  | { proceed: false; code: PreconditionCode; detail: string }

/** How long after looking at a subject we decline to look again. A policy value. */
export const DEFAULT_REFRACTORY_MS = 12 * 60 * 60 * 1000

/**
 * The state each expectation asserts. Total over `ExpectationKind`, so a new
 * detector cannot reach production without declaring what its violation means —
 * the same compiler enforcement `notificationOwnership.ts` applies to ownership.
 */
export const EXPECTED_STATE: Record<ExpectationKind, QualifyingState> = {
  'followup.overdue': 'FOLLOWUP_OVERDUE',
  'sla.open_loop': 'OPEN_LOOP_SLA',
}

export interface PreconditionDeps {
  /**
   * Injected like every other dependency so P2–P5 are reachable in a test. It is
   * NOT a policy switch: the only production value is the real registry lookup,
   * and `investigationAdmission` never passes an override.
   */
  isOwnedByDeterministicNotification?: typeof isOwnedByDeterministicNotification
  readLeadFact?: typeof defaultReadLeadFact
  lastReservationForSubject?: typeof defaultLastReservation
  resolveAutonomousScope?: typeof defaultResolveScope
}

export interface PreconditionOptions {
  now?: Date
  refractoryMs?: number
  /** Subject ids already taken by an earlier job in this same pass (P2). */
  claimedSubjects?: ReadonlySet<string>
  deps?: PreconditionDeps
}

/** Narrow the job's `expectation` (a plain string in storage) to the closed union. */
function asExpectation(raw: string): ExpectationKind | null {
  return raw in EXPECTED_STATE ? (raw as ExpectationKind) : null
}

export async function checkPreconditions(job: SignalJob, opts: PreconditionOptions = {}): Promise<PreconditionResult> {
  const now = opts.now ?? new Date()
  const refractoryMs = opts.refractoryMs ?? DEFAULT_REFRACTORY_MS
  const deps = opts.deps ?? {}
  const isOwned = deps.isOwnedByDeterministicNotification ?? isOwnedByDeterministicNotification
  const readLeadFact = deps.readLeadFact ?? defaultReadLeadFact
  const lastReservation = deps.lastReservationForSubject ?? defaultLastReservation
  const resolveScope = deps.resolveAutonomousScope ?? defaultResolveScope

  const expectation = asExpectation(job.expectation)
  if (expectation === null) {
    // An expectation with no declared meaning cannot be investigated. Not an
    // error — a judgement, and a permanent one.
    return { proceed: false, code: 'state_no_longer_holds', detail: `undeclared expectation '${job.expectation}'` }
  }

  // ── P1 · ownership novelty. Free: no query, no allocation. ──────────────────
  if (isOwned(expectation)) {
    return {
      proceed: false,
      code: 'owned_by_deterministic_notification',
      detail: `'${expectation}' is already delivered deterministically`,
    }
  }

  // Only lead subjects are investigable; a portfolio has no single owed action.
  if (job.subjectType !== 'lead') {
    return { proceed: false, code: 'state_no_longer_holds', detail: `subject type '${job.subjectType}' is not investigable` }
  }

  // ── P2 · coalesce. One investigation per SUBJECT, never per signal. ─────────
  if (opts.claimedSubjects?.has(job.subjectId)) {
    return { proceed: false, code: 'coalesced_into_sibling', detail: `subject ${job.subjectId} already taken this pass` }
  }

  // ── P3 · refractory. A decline is still a look. ────────────────────────────
  const previous = await lastReservation({
    agencyId: job.agencyId,
    subjectType: 'lead',
    subjectId: job.subjectId,
  })
  if (previous) {
    const since = now.getTime() - Date.parse(previous.createdAt)
    if (Number.isFinite(since) && since >= 0 && since < refractoryMs) {
      return { proceed: false, code: 'within_refractory_window', detail: `looked at ${Math.round(since / 1000)}s ago` }
    }
  }

  // ── P4 · is it still true? classifyLead is the sole authority. ─────────────
  const leadId = Number(job.subjectId)
  if (!Number.isInteger(leadId) || leadId <= 0) {
    return { proceed: false, code: 'state_no_longer_holds', detail: `subject id '${job.subjectId}' is not a lead id` }
  }
  const fact = await readLeadFact({ agencyId: job.agencyId }, leadId)
  if (!fact) {
    return { proceed: false, code: 'state_no_longer_holds', detail: 'lead is gone, terminal, or over quota' }
  }
  const ctx = businessDayBounds(now.getTime())
  const state = classifyLead(fact, ctx)
  if (state === null || state !== EXPECTED_STATE[expectation]) {
    return {
      proceed: false,
      code: 'state_no_longer_holds',
      detail: `expected ${EXPECTED_STATE[expectation]}, now ${state ?? 'no qualifying state'}`,
    }
  }

  // ── P5 · who acts, and may they? ───────────────────────────────────────────
  const resolved = await resolveScope({ agencyId: job.agencyId, leadId })
  if (resolved.ok === false) {
    return { proceed: false, code: 'no_operator', detail: resolved.reason }
  }

  const expectedByRaw = job.signal?.absence?.expectedBy
  const expectedByMs = typeof expectedByRaw === 'string' ? Date.parse(expectedByRaw) : NaN

  return {
    proceed: true,
    scope: resolved.scope,
    state,
    operatorUserId: resolved.scope.userId,
    value: {
      state,
      // P1 already answered this; carrying its answer keeps one source.
      ownedByDeterministicNotification: isOwned(expectation),
      expectedByMs: Number.isFinite(expectedByMs) ? expectedByMs : null,
      clock: ctx,
      vigilance: vigilanceClassFor(expectation),
    },
  }
}
