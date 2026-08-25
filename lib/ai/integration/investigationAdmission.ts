import { checkPreconditions as defaultCheckPreconditions, type PreconditionCode } from './preconditions'
import { objectiveFor } from './investigationObjective'
import { bridgeInvestigation as defaultBridge } from './investigationBridge'
import { runAgentInvestigation as defaultRunAgent } from '@/lib/agent/run'
import { decide as defaultDecide } from '@/lib/ai/runtime/toolAction'
import { recordInvestigation as defaultRecordInvestigation } from '@/db/ai/investigations'
import { recordCoverageDecision as defaultRecordCoverage } from '@/db/ai/shadowCoverage'
import { emitInsight as defaultEmitInsight } from './insightEmit'
import {
  reserve as defaultReserve,
  release as defaultRelease,
  settle as defaultSettle,
  releaseExpired as defaultReleaseExpired,
  isReservationActive as defaultIsReservationActive,
} from '@/db/ai/spendReservations'
import type { SignalJob } from '@/db/ai/signalJobs'

/**
 * Investigation admission and execution — the controlled bridge from a leased
 * signal job to a grounded Recommend.
 *
 * The ordering IS the safety property, and every step is load-bearing:
 *
 *   preconditions -> reserve -> investigate -> validate -> bridge -> gate -> settle
 *
 * Nothing costs anything until every precondition passes. No model is reachable
 * except through a held reservation. No claim reaches the gate unless the
 * validator kept it. No Recommend is recorded unless the hold is still alive.
 * Spend is settled on every terminal path, including the ones that failed.
 *
 * WHAT THIS MODULE DOES NOT DO. It does not rank (the claim is oldest-first), does
 * not classify business state (classifyLead did), does not decide whether to
 * surface (the Value Bar does), and delivers nothing to anyone — no notification
 * type, no notifyEvent import, no insight record. Phase 4.3 ends at the shadow sink.
 *
 * THE THREE OUTCOME CLASSES, now covering the model as well:
 *
 *   JUDGEMENT  - examined, nothing owed. SUCCEED. Never retry: a validator
 *                refusal, a gate rejection and a deliberate silence are verdicts,
 *                and re-spending to reach the same verdict is pure waste.
 *   CAPACITY   - nothing was examined. LEAVE PENDING and give the attempt back.
 *   TRANSPORT  - a provider error. The existing failSignalJob ladder owns it.
 */

export type AdmissionOutcome =
  | 'recommended'
  | 'silent'
  | 'gate_rejected'
  | 'refused'
  | 'declined_precondition'
  | 'declined_capacity'
  | 'transport_failed'

export type JobDisposition = 'succeed' | 'leave_pending' | 'fail'

export interface AdmissionResult {
  outcome: AdmissionOutcome
  jobDisposition: JobDisposition
  preconditionCode?: PreconditionCode
  capacityReason?: string
  reservationId?: number
  operatorUserId?: number
  investigationId?: string
  /** What the run actually cost. Settled against the hold on every path. */
  costUsd: number
  detail: string
}

export interface AdmissionDeps {
  checkPreconditions?: typeof defaultCheckPreconditions
  reserve?: typeof defaultReserve
  release?: typeof defaultRelease
  settle?: typeof defaultSettle
  releaseExpired?: typeof defaultReleaseExpired
  isReservationActive?: typeof defaultIsReservationActive
  runAgent?: typeof defaultRunAgent
  bridge?: typeof defaultBridge
  decide?: typeof defaultDecide
  recordInvestigation?: typeof defaultRecordInvestigation
  recordCoverage?: typeof defaultRecordCoverage
  emitInsight?: typeof defaultEmitInsight
}

export interface AdmissionOptions {
  now?: Date
  leaseMs?: number
  refractoryMs?: number
  claimedSubjects?: ReadonlySet<string>
  /** Per-call Agent budget. The Agent's global defaults are never changed. */
  agentMaxSteps?: number
  agentDeadlineMs?: number
  sweepBucket?: number
  deps?: AdmissionDeps
}

export const DEFAULT_LEASE_MS = 5 * 60 * 1000
/** Tight enough that one investigation fits the tick's third phase. */
export const AUTONOMOUS_MAX_STEPS = 4
export const AUTONOMOUS_DEADLINE_MS = 20_000

/** Release every hold whose owning lease expired. Composes with the reclaim pass. */
export async function reclaimExpiredReservations(now: Date = new Date(), deps: AdmissionDeps = {}): Promise<number> {
  return (deps.releaseExpired ?? defaultReleaseExpired)(now)
}

export async function admitInvestigation(job: SignalJob, opts: AdmissionOptions = {}): Promise<AdmissionResult> {
  const now = opts.now ?? new Date()
  const leaseMs = opts.leaseMs ?? DEFAULT_LEASE_MS
  const d = opts.deps ?? {}
  const checkPreconditions = d.checkPreconditions ?? defaultCheckPreconditions
  const reserve = d.reserve ?? defaultReserve
  const settle = d.settle ?? defaultSettle
  const isActive = d.isReservationActive ?? defaultIsReservationActive
  const runAgent = d.runAgent ?? defaultRunAgent
  const bridge = d.bridge ?? defaultBridge
  const decide = d.decide ?? defaultDecide
  const recordInvestigation = d.recordInvestigation ?? defaultRecordInvestigation
  const recordCoverage = d.recordCoverage ?? defaultRecordCoverage
  const emitInsight = d.emitInsight ?? defaultEmitInsight

  // 1. Preconditions. Nothing is reserved until every one passes.
  const pre = await checkPreconditions(job, {
    now,
    refractoryMs: opts.refractoryMs,
    claimedSubjects: opts.claimedSubjects,
  })
  if (pre.proceed === false) {
    return {
      outcome: 'declined_precondition',
      jobDisposition: 'succeed',
      preconditionCode: pre.code,
      costUsd: 0,
      detail: pre.detail,
    }
  }

  // 2. Reserve. Only now does anything cost, and the hold dies with the lease.
  const held = await reserve({
    agencyId: job.agencyId,
    signalJobId: job.id,
    observationKey: job.observationKey,
    subjectType: 'lead',
    subjectId: job.subjectId,
    operatorUserId: pre.operatorUserId,
    expiresAt: new Date(now.getTime() + leaseMs),
    now,
  })
  if (held.reserved === false) {
    return {
      outcome: 'declined_capacity',
      jobDisposition: 'leave_pending',
      capacityReason: held.reason,
      operatorUserId: pre.operatorUserId,
      costUsd: 0,
      detail: `capacity: ${held.reason}`,
    }
  }
  const reservationId = held.row.id

  const objective = objectiveFor(job.expectation)
  const base = {
    agencyId: job.agencyId,
    signalJobId: job.id,
    observationKey: job.observationKey,
    expectation: job.expectation,
    subjectType: 'lead' as const,
    subjectId: job.subjectId,
    reservationId,
    operatorUserId: pre.operatorUserId,
    objective,
  }

  // 3. Investigate. The SAME Agent runtime, entered through a sessionless door.
  let result
  try {
    result = await runAgent({
      question: objective,
      scope: pre.scope,
      // Autonomous work is accounted DURABLY. Charging the shared in-memory
      // counter would let proactive work deny a rep an interactive answer.
      skipInteractiveSpend: true,
      maxSteps: opts.agentMaxSteps ?? AUTONOMOUS_MAX_STEPS,
      deadlineMs: opts.agentDeadlineMs ?? AUTONOMOUS_DEADLINE_MS,
      now: () => now.getTime(),
    })
  } catch (err) {
    await settle(reservationId, 0, 'admitted').catch(() => undefined)
    await recordInvestigation({
      ...base,
      investigationId: `inv_failed_${job.id}`,
      status: 'failed',
      stopReason: 'error',
      costUsd: 0,
      failureReason: (err as Error).message,
    }).catch(() => undefined)
    return {
      outcome: 'transport_failed',
      jobDisposition: 'fail',
      reservationId,
      operatorUserId: pre.operatorUserId,
      costUsd: 0,
      detail: (err as Error).message,
    }
  }

  const costUsd = result.costUsd ?? 0
  const investigationId = result.investigationId ?? `inv_unknown_${job.id}`

  // Settle FIRST, on every path. Tokens were spent whatever happens next, and an
  // accounting step that only runs on success is an accounting step that lies.
  await settle(reservationId, costUsd, 'admitted').catch(() => undefined)

  if (result.ok === false) {
    // gate_denied is CAPACITY: the AI gate refused before generation, so nothing
    // was examined and the attempt must not be spent. Everything else here is a
    // judgement (refusal) or transport (error).
    const capacity = result.reason === 'gate_denied'
    const transport = result.reason === 'error'
    await recordInvestigation({
      ...base,
      investigationId,
      status: capacity || transport ? 'failed' : 'refused',
      stopReason: result.reason,
      costUsd,
      failureReason: result.message ?? null,
    }).catch(() => undefined)
    return {
      outcome: capacity ? 'declined_capacity' : transport ? 'transport_failed' : 'refused',
      jobDisposition: capacity ? 'leave_pending' : transport ? 'fail' : 'succeed',
      ...(capacity ? { capacityReason: result.message ?? 'gate_denied' } : {}),
      reservationId,
      operatorUserId: pre.operatorUserId,
      investigationId,
      costUsd,
      detail: result.reason,
    }
  }

  // 4. Bridge. Validated claims only; the raw answer never reaches the gate.
  const understanding = bridge({
    scope: { agencyId: job.agencyId },
    subject: { subjectType: 'lead', subjectId: job.subjectId },
    claims: result.answer.claims,
    evidence: result.evidence,
    reason: 'absence',
    asOf: now.toISOString(),
  })

  // 5. Gate. ALWAYS surface mode - inspect would skip the Value Bar entirely.
  const decision = decide(understanding, {
    scope: { agencyId: job.agencyId },
    now,
    intent: { mode: 'surface', value: pre.value },
  })

  const gateOutcome = decision.emitted ? decision.outcome : 'rejected'
  const silenceReason = decision.emitted && decision.outcome === 'stay_silent' ? decision.silence.reason : null

  // 6. Record. A Recommend is written only while the hold is provably alive.
  if (gateOutcome === 'recommend' && (await isActive(reservationId, now)) === false) {
    await recordInvestigation({
      ...base,
      investigationId,
      status: 'refused',
      stopReason: 'deadline',
      gateOutcome: 'rejected',
      costUsd,
      failureReason: 'lease-expired-before-record',
    }).catch(() => undefined)
    return {
      outcome: 'gate_rejected',
      jobDisposition: 'succeed',
      reservationId,
      operatorUserId: pre.operatorUserId,
      investigationId,
      costUsd,
      detail: 'reservation no longer active; recommendation discarded',
    }
  }

  await recordInvestigation({
    ...base,
    investigationId,
    status: 'answered',
    stopReason: result.stopReason,
    gateOutcome,
    silenceReason,
    answer: result.answer,
    evidence: [...result.evidence],
    steps: result.steps,
    costUsd,
  }).catch(() => undefined)

  await recordCoverage({
    agencyId: job.agencyId,
    subjectType: 'lead',
    subjectId: job.subjectId,
    reason: 'absence',
    outcome: gateOutcome,
    emitted: decision.emitted,
    rejectionBoundary: 'rejection' in decision ? decision.rejection.boundary : null,
    decision,
    sweptAt: now.toISOString(),
    sweepBucket: opts.sweepBucket ?? Math.floor(now.getTime() / (60 * 60 * 1000)),
  }).catch(() => undefined)

  // ── 7. Phase 4.4: a Recommend becomes a durable CONCLUSION. ───────────────
  //
  // Only a Recommend. A silence and a rejection are the Value Bar and the safety
  // spine doing their job, and neither produces anything to record or deliver.
  // The emitter records the insight unconditionally and treats DELIVERY as a
  // separate, gated, capped attempt — so a conclusion is never lost to a closed
  // gate, and a closed gate never turns into a conclusion nobody reached.
  let insightDetail: string | null = null
  if (gateOutcome === 'recommend') {
    try {
      const emitted = await emitInsight(
        {
          agencyId: job.agencyId,
          subjectId: job.subjectId,
          expectation: job.expectation,
          investigationId,
          operatorUserId: pre.operatorUserId,
          headline: result.answer.headline,
          claims: result.answer.claims,
          evidence: [...result.evidence],
          reasoningChain: 'recommendation' in decision ? decision.recommendation.reasoningChain : [],
          decisionTrace: decision.trace,
        },
        { now },
      )
      insightDetail = emitted.outcome
    } catch (err) {
      // Recording or delivering an insight must never fail the investigation: the
      // model call is already paid for and the run is already audited. The signal
      // job stays SUCCEEDED and the next investigation can conclude again.
      insightDetail = `insight-failed:${(err as Error).message}`
      console.error(`[investigation] insight emit failed job=${job.id}:`, (err as Error).message)
    }
  }

  return {
    outcome: gateOutcome === 'recommend' ? 'recommended' : gateOutcome === 'stay_silent' ? 'silent' : 'gate_rejected',
    jobDisposition: 'succeed',
    reservationId,
    operatorUserId: pre.operatorUserId,
    investigationId,
    costUsd,
    detail: insightDetail ?? silenceReason ?? gateOutcome,
  }
}

export { defaultRelease as releaseReservation }
