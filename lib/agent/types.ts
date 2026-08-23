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
 */
export type EvidenceRef =
  | { kind: 'lead'; refId: string }
  | { kind: 'conversation'; refId: string }
  | { kind: 'message'; refId: string }
  | { kind: 'metric'; metric: string; window: { from: string; to: string }; n: number }

/** The entity kinds addressable by `EvidenceCollector.has`. */
export type EvidenceEntityKind = 'lead' | 'conversation' | 'message'

/**
 * Epistemic class of one statement. The validator enforces the difference —
 * an INFERENCE written as a bare assertion is dropped rather than surfaced.
 */
export type ClaimClass = 'FACT' | 'OBSERVATION' | 'INFERENCE' | 'RECOMMENDATION'

export type Claim = {
  claimClass: ClaimClass
  text: string
  /** refIds (or metric names) this claim rests on. Validated against the collector. */
  evidence: string[]
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

export type AgentResult =
  | { ok: true; answer: AgentAnswer; evidence: EvidenceRef[]; steps: number; stopReason: StopReason }
  | { ok: false; reason: StopReason; message?: string }
