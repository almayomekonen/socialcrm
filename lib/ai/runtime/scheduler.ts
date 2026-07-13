import {
  listStaleBeliefs as defaultListStaleBeliefs,
  type Scope,
  type SubjectRef,
  type SubjectType,
  type StoredBelief,
} from '@/db/ai/stateManagement'
import type { DecayPolicy } from '@/db/ai/decay'
import type { RuntimeEvent } from './eventInterpretation'

/**
 * M4 — Runtime Scheduler (Wave 1). The first *active* runtime component.
 *
 * Its responsibility is not reasoning; it decides *what deserves cognition*.
 * It realizes the attention controller / continuous loop (Cognitive Architecture
 * C, D; AI Runtime Architecture §3.6). It runs two attention tiers:
 *
 *   • Tier 1 — a pre-attentive coverage sweep over *every* live relationship on
 *     cadence, plus time-driven staleness re-attention. Coverage is guaranteed
 *     as *membership, not simultaneity*: the swept set never shrinks under load
 *     (M0 Part 5; Constitution VI.4, XI.4).
 *   • Tier 2 — salience-based admission of the few: event-driven triggers
 *     (inbound trace, absence) admitted for deep processing.
 *
 * Its only output is the canonical **cognition request** — a decision that a
 * subject deserves cognition, at a tier, for a reason. It is not a belief and
 * not a recommendation.
 *
 * This component realizes two M0 events as return values (there is no event bus
 * in Wave 1): the **coverage-sweep tick** (the swept membership set carried on
 * {@link CoverageSweepResult.membership}) and **staleness flagged** (each
 * `reason: 'staleness'` request, carrying the stale region and elapsed time).
 *
 * It MUST NOT infer beliefs, prioritize business outcomes, generate
 * recommendations, reason, plan, or execute actions. It performs no writes.
 *
 * Residency (Constitution I.1) lives in State Management (M1) and the World
 * Model (M2); the Scheduler holds only the membership set. Membership is
 * re-seeded from the live roster each cycle and is monotonic within a run —
 * honest for a stateless (e.g. serverless) driver, where the roster is the
 * source of truth of which relationships are live.
 *
 * Deferred by Wave 1 scope (not built here): the dropped-ball vigilance path
 * that constructs an Action-descriptor (that is the M5 Tool/Action Runtime — the
 * Scheduler stops at the cognition request); operator-economy arbitration; and
 * the cron/roster wiring that drives sweeps.
 */

export type CognitionTier = 1 | 2

export type AdmissionReason = 'coverage_sweep' | 'staleness' | 'inbound' | 'absence'

/** A back-reference to the runtime event that admitted a request (its provenance). */
export interface TriggerRef {
  kind: RuntimeEvent['kind']
  asOfTime?: string
}

/**
 * The Scheduler's sole output. Realizes Cog D admission: a bounded statement
 * that a subject deserves cognition. Carries no belief content, no confidence,
 * and no recommendation.
 */
export interface CognitionRequest {
  scope: Scope
  subject: SubjectRef
  tier: CognitionTier
  reason: AdmissionReason
  /** ISO time the request was admitted. */
  admittedAt: string
  /** For event-driven admissions: which canonical event admitted it. */
  trigger?: TriggerRef
  /** For staleness re-attention: how long the region has been unobserved (ms). */
  elapsedMs?: number
}

/** The result of one elapsed-time coverage sweep (realizes the coverage-sweep tick). */
export interface CoverageSweepResult {
  scope: Scope
  sweptAt: string
  /** The swept membership set — every live relationship, sorted. Never shrinks under load. */
  membership: string[]
  /** The stale regions detected this sweep, most-overdue first. */
  staleSubjects: SubjectRef[]
  /** Tier-1 coverage requests (one per member) followed by Tier-1 staleness requests. */
  requests: CognitionRequest[]
}

export interface SweepOptions {
  now?: Date
  policy?: DecayPolicy
}

export interface AdmitOptions {
  now?: Date
}

type StaleReader = (scope: Scope, opts: { now?: Date; policy?: DecayPolicy }) => Promise<StoredBelief[]>

export interface SchedulerDeps {
  /** The staleness detector. Defaults to M1's `listStaleBeliefs`; injectable for tests. */
  listStaleBeliefs?: StaleReader
}

export class RuntimeScheduler {
  private readonly scope: Scope
  /** Live relationship (lead) subject ids. Grows via seed/admit/sweep; never shrinks. */
  private readonly members = new Set<string>()
  private readonly readStale: StaleReader

  constructor(scope: Scope, deps: SchedulerDeps = {}) {
    if (!scope || !Number.isInteger(scope.agencyId) || scope.agencyId <= 0) {
      throw new RangeError(`RuntimeScheduler: scope.agencyId must be a positive integer, got ${String(scope?.agencyId)}`)
    }
    this.scope = Object.freeze({ agencyId: scope.agencyId })
    this.readStale = deps.listStaleBeliefs ?? defaultListStaleBeliefs
  }

  /**
   * Membership tracking. Unions a roster of live relationships into the swept
   * set. Ignores blanks; never removes an existing member (coverage never
   * shrinks under load — M0 Part 5).
   */
  seed(subjectIds: Iterable<string>): void {
    for (const id of subjectIds) {
      if (typeof id === 'string' && id.length > 0) this.members.add(id)
    }
  }

  /** The current swept membership set, sorted for deterministic output. */
  get membership(): string[] {
    return [...this.members].sort()
  }

  /** Number of live relationships currently tracked. */
  get size(): number {
    return this.members.size
  }

  /**
   * Trigger admission (event-driven). Transforms one canonical M3 runtime event
   * into cognition requests. Pure and side-effect-free apart from monotonic
   * membership growth; performs no I/O.
   *
   * An inbound trace or a detected absence is a salient candidate → admitted at
   * Tier 2 for deep processing. An elapsed-time tick admits no subject (it is
   * the cadence cue that drives {@link sweep}). A subjectless signal admits
   * nothing — there is no relationship to bring into cognition. Events for
   * another scope are ignored (scope isolation, Constitution VII.5).
   */
  admit(event: RuntimeEvent, opts: AdmitOptions = {}): CognitionRequest[] {
    const eventScope = event.kind === 'elapsed_time_tick' ? event.scope : event.signal.scope
    if (eventScope.agencyId !== this.scope.agencyId) return []

    if (event.kind === 'elapsed_time_tick') return []

    const subject = event.signal.subject
    if (!subject) return []

    // A relationship becomes live the moment it is first observed.
    if (subject.subjectType === 'lead') this.members.add(subject.subjectId)

    const admittedAt = (opts.now ?? new Date()).toISOString()
    const reason: AdmissionReason = event.kind === 'absence_detected' ? 'absence' : 'inbound'

    return [
      {
        scope: this.scope,
        subject,
        tier: 2,
        reason,
        admittedAt,
        trigger: { kind: event.kind, asOfTime: event.signal.asOfTime },
      },
    ]
  }

  /**
   * Elapsed-time coverage sweep (Tier 1). Emits one coverage request per live
   * relationship (the coverage floor) and one staleness re-attention request per
   * stale region (fires on time alone). Any stale relationship that carries
   * state is added to membership so it can never be missed.
   *
   * Under load the *cadence* between sweeps lengthens (the driver calls this
   * less often); a single sweep still covers the entire membership — depth
   * bends, coverage never does.
   */
  async sweep(opts: SweepOptions = {}): Promise<CoverageSweepResult> {
    const now = opts.now ?? new Date()
    const sweptAt = now.toISOString()

    // Staleness detection — model-independent, fires on elapsed time (M1).
    const stale = await this.readStale(this.scope, { now, policy: opts.policy })

    // Collapse to distinct stale subjects, keeping the most-overdue elapsed time.
    const staleBy = new Map<string, { subject: SubjectRef; elapsedMs: number }>()
    for (const b of stale) {
      if (b.subjectType === 'lead') this.members.add(b.subjectId)
      const key = `${b.subjectType}:${b.subjectId}`
      const prev = staleBy.get(key)
      if (!prev || b.ageMs > prev.elapsedMs) {
        staleBy.set(key, { subject: { subjectType: b.subjectType, subjectId: b.subjectId }, elapsedMs: b.ageMs })
      }
    }

    // Coverage floor: every live relationship is swept (Tier 1), sorted.
    const membership = this.membership
    const requests: CognitionRequest[] = membership.map((subjectId) => ({
      scope: this.scope,
      subject: { subjectType: 'lead' as SubjectType, subjectId },
      tier: 1 as CognitionTier,
      reason: 'coverage_sweep' as AdmissionReason,
      admittedAt: sweptAt,
    }))

    // Staleness re-attention: additive Tier-1 flag, most-overdue first. This
    // ordering is time-based fairness (surface the longest-unobserved region
    // first), never a comparative ranking of business value.
    const staleSorted = [...staleBy.values()].sort(
      (a, z) => z.elapsedMs - a.elapsedMs || (a.subject.subjectId < z.subject.subjectId ? -1 : 1),
    )
    for (const s of staleSorted) {
      requests.push({
        scope: this.scope,
        subject: s.subject,
        tier: 1,
        reason: 'staleness',
        admittedAt: sweptAt,
        elapsedMs: s.elapsedMs,
      })
    }

    return {
      scope: this.scope,
      sweptAt,
      membership,
      staleSubjects: staleSorted.map((s) => s.subject),
      requests,
    }
  }
}
