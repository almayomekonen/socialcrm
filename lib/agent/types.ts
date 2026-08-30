import type { Roles } from '@/types/roles'
import type { Plan } from '@/lib/quota/types'

/**
 * SocialCRM Agent — shared types.
 *
 * The Agent investigates by calling business-level tools rather than being
 * handed one fixed snapshot. These are the contracts every tool and the loop
 * share. All are plain data: no I/O, no framework.
 */

/**
 * Server-resolved authority for ONE investigation.
 *
 * Captured in every tool closure. It is NEVER accepted from the model and never
 * appears in a tool's input schema — that is what makes agency isolation
 * structural rather than a prompt instruction. See lib/agent/scope.ts.
 */
export type AgentScope = {
  agencyId: number
  userId: number
  role: Roles
  /**
   * Permission set from `getPerms`. Empty for admins (unrestricted — the
   * `isAdmin` branch at each query site is what widens it), `[0]` for a user
   * with no grants (a sentinel that matches no row).
   */
  gotPermIds: number[]
  plan: Plan
  /** Resolved via getFirstName; '' when no name source exists. */
  firstName: string
}

/**
 * A citable source. The only thing a claim may point at.
 *
 * Entity refs carry the id a tool actually returned. A metric ref carries its
 * name, the window it was measured over and the sample size — so an OBSERVATION
 * can never be surfaced without the `n` that makes it honest.
 *
 * A metric also records WHAT IT WAS MEASURED ON, when it was measured over one
 * entity. Without that binding a metric is subject-less: `lead.overdueTaskCount
 * = 0` states a number but names nothing a rep could open, so a claim resting
 * only on it has no provenance to walk and can never be surfaced. `measuredOn`
 * is written by the TOOL that took the measurement, never by the model, and is
 * absent for portfolio-wide metrics (`get_today_state`), which are measured over
 * no single subject and must not borrow one.
 */
export type EvidenceRef =
  | { kind: 'lead'; refId: string }
  | { kind: 'conversation'; refId: string }
  | { kind: 'message'; refId: string }
  | {
      kind: 'metric'
      metric: string
      window: { from: string; to: string }
      n: number
      measuredOn?: { kind: EvidenceEntityKind; refId: string }
    }

/** The entity kinds addressable by `EvidenceCollector.has`. */
export type EvidenceEntityKind = 'lead' | 'conversation' | 'message'

/**
 * Epistemic class of one statement.
 *
 * These are a DISCRIMINATED UNION with class-specific evidence field names, not
 * a single shape with a label. That is deliberate: if every class carried the
 * same `evidence: string[]`, relabelling an inference as a fact would cost the
 * model one string and only prose inspection could catch it — which would make
 * the whole trust boundary rest on a regex.
 *
 * Instead each class asks for a differently-named field holding a different
 * KIND of evidence, and the validator checks the refs actually resolve to that
 * kind in the collector:
 *
 *   FACT           entityEvidence — lead / conversation / message refIds
 *   OBSERVATION    metricEvidence — metric names that exist WITH their sample size
 *   INFERENCE      evidence (either kind) AND a hedge in the prose
 *   RECOMMENDATION evidence (either kind)
 *
 * Promoting an inference to a FACT therefore means moving refs into
 * `entityEvidence` and having them resolve to real entities; promoting it to an
 * OBSERVATION means naming a metric the collector actually holds. Mislabelling
 * costs fabrication the validator can detect, rather than a relabel it cannot.
 */
export const CLAIM_CLASSES = ['FACT', 'OBSERVATION', 'INFERENCE', 'RECOMMENDATION'] as const
export type ClaimClass = (typeof CLAIM_CLASSES)[number]

/** Something read directly from source rows. Cites the rows. */
export type FactClaim = {
  claimClass: 'FACT'
  text: string
  /** lead / conversation / message refIds. Must resolve as entities. */
  entityEvidence: string[]
}

/** A measurement. Cites the metric, which carries its own window and sample size. */
export type ObservationClaim = {
  claimClass: 'OBSERVATION'
  text: string
  /** Metric names. Must exist in the collector — a metric ref carries `n`. */
  metricEvidence: string[]
}

/** A judgement about relationship or cause. Must be hedged AND grounded. */
export type InferenceClaim = {
  claimClass: 'INFERENCE'
  text: string
  /** Entity refIds or metric names — either kind grounds an inference. */
  evidence: string[]
}

/** Proposed next action. Advice, never asserted as fact. */
export type RecommendationClaim = {
  claimClass: 'RECOMMENDATION'
  text: string
  /** Entity refIds or metric names — either kind grounds a recommendation. */
  evidence: string[]
}

export type Claim = FactClaim | ObservationClaim | InferenceClaim | RecommendationClaim

/** The refs a claim cites, whatever its class calls the field. */
export function claimRefs(claim: Claim): string[] {
  switch (claim.claimClass) {
    case 'FACT':
      return claim.entityEvidence
    case 'OBSERVATION':
      return claim.metricEvidence
    default:
      return claim.evidence
  }
}

/** Rebuild a claim with a new ref list, preserving its class and field name. */
export function withClaimRefs(claim: Claim, refs: string[]): Claim {
  switch (claim.claimClass) {
    case 'FACT':
      return { ...claim, entityEvidence: refs }
    case 'OBSERVATION':
      return { ...claim, metricEvidence: refs }
    default:
      return { ...claim, evidence: refs }
  }
}

export type AgentAnswer = {
  /** The one-line conclusion the rep reads first. */
  headline: string
  claims: Claim[]
  /** Honest statement of what could not be determined, or null. */
  unknown: string | null
}

/** Why an investigation ended. Recorded on every run for observability. */
export type StopReason =
  | 'answered'
  | 'step_ceiling'
  | 'deadline'
  | 'repeat_call'
  | 'no_new_information'
  | 'no_evidence'
  | 'gate_denied'
  | 'error'

/**
 * `investigationId` is minted server-side in lib/agent/run.ts and is the same id
 * that correlates the trace lines and the persisted row. It is returned so a
 * later question about an answer can be traced to the run that produced it. It
 * is NEVER accepted as input: a caller-supplied id would let one client
 * overwrite another's history, because persistence is first-write-wins.
 *
 * Optional on failure because a request can fail before an id exists — an empty
 * question is rejected before any investigation starts.
 */
export type AgentResult =
  | {
      ok: true
      answer: AgentAnswer
      evidence: EvidenceRef[]
      steps: number
      stopReason: StopReason
      investigationId: string
      /**
       * What this investigation actually cost, in USD.
       *
       * Exposed in Phase 4.3 because the autonomous path holds a durable budget
       * reservation that must be SETTLED against the real figure — a hold that is
       * never closed against actuals is a hold that silently over-charges the day.
       * The interactive path may ignore it; nothing about its behaviour changes.
       *
       * Zero when generation never began (an admission denial spends nothing).
       */
      costUsd: number
    }
  | {
      ok: false
      reason: StopReason
      message?: string
      investigationId?: string
      /** Tokens are spent even when the answer is refused or the provider fails. */
      costUsd?: number
      /**
       * EXECUTION TELEMETRY ON THE FAILURE PATH — present whenever generation ran.
       *
       * These were assembled for `onPersist` and then dropped from the return, so a
       * caller that persists from the AgentResult rather than from `onPersist` — the
       * autonomous path — wrote nothing and `ai_investigations` fell back to its
       * column defaults (`steps 0`, `evidence []`, `droppedClaims 0`,
       * `strippedRefs 0`). That made "four tools ran, then the validator refused"
       * indistinguishable from "no tool ran, then the validator refused", and three
       * production investigations were diagnosed against a number that was a DEFAULT,
       * never a measurement.
       *
       * Optional because two failures genuinely have no telemetry: an admission
       * denial never began, and a provider throw before any step has nothing to
       * report. Absent means "not measured", never "measured as zero".
       */
      steps?: number
      evidence?: EvidenceRef[]
      droppedClaims?: number
      strippedRefs?: number
      /** The validator's own rejection reason, so a refusal says WHY. */
      rejection?: string | null
    }
