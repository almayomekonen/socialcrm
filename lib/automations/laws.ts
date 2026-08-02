import type { AutomationTriggerEvent, LawDecision, SkipReason } from './types'
import { TERMINAL_LEAD_STATUSES } from './types'
import { withinQuietHours, type QuietHoursConfig } from './timing'
import { getAction } from './catalog/registry'
import type { FieldType, LawKey } from './catalog/vocabularies'

/**
 * The engine's laws — pure decisions over gathered facts, no I/O (the IRE
 * decideEligibility shape). The worker (Phase 4) gathers SendFacts and calls
 * decideSend as the authoritative pre-send check; call sites additionally
 * never enqueue import-origin events (Phase 3), so the origin law here is the
 * second, unconditional layer of the same rule.
 *
 * Laws live HERE, engine-level — never in individual actions — so every
 * future action (WhatsApp, SMS) inherits them unchanged (ADR-001).
 */

// Safe-by-default limits. Lead cap per spec §9 (max automated emails per lead
// per day); agency ceiling cloned from the IRE dailyCap default.
export const DEFAULT_LEAD_DAILY_CAP = 2
export const DEFAULT_AGENCY_DAILY_CEILING = 200

export interface SendFacts {
  event: AutomationTriggerEvent
  // status_changed automations: the status the automation is premised on.
  expectedStatus?: string | null
  lead: {
    exists: boolean
    email: string | null
    currentStatus: string | null
    emailUndeliverable: boolean
  }
  suppressed: boolean
  alreadySent: boolean // send-once claim already recorded (ADR-005)
  sentToLeadToday: number // automated emails this lead received today (all automations)
  sentByAgencyToday: number // automated emails this business sent today
  limits?: { leadDailyCap?: number; agencyDailyCeiling?: number }
  quietHours?: QuietHoursConfig | null
  now: Date
}

export function isTerminalStatus(status: string | null | undefined): boolean {
  return status != null && (TERMINAL_LEAD_STATUSES as readonly string[]).includes(status)
}

const skip = (reason: SkipReason): LawDecision => ({ allow: false, reason })

/**
 * B2 — the law pipeline is COMPOSED from each action's declared `laws`
 * (frozen spec §3.8), not hardcoded. This is the first runtime consumption of
 * catalog metadata (docs/catalog-adoption-strategy.md).
 *
 * Two categories, deliberately distinct:
 *
 *   UNIVERSAL GUARDS run for every action and are NOT catalog-declared. They
 *   protect the engine's own integrity (is this event even legitimate? does
 *   the subject still exist? does its premise still hold?), apply to every
 *   action that will ever exist, and must not be opt-out-able by omitting a
 *   declaration.
 *
 *   PER-ACTION LAWS are declared by the action. `task.create` declaring only
 *   `send_once` is how a suppressed lead still gets a task created for the rep
 *   — suppression is consent not to be *contacted*, which says nothing about
 *   internal record-keeping.
 *
 * Order is contract (ADR-011): first skip wins, and it decides which reason the
 * activity log shows when several apply. PIPELINE_ORDER below reproduces the
 * pre-B2 sequence exactly.
 */

type LawEvaluator = (f: SendFacts) => SkipReason | null

/**
 * Exhaustive by construction: `Record<LawKey, …>` means adding a law to the
 * vocabulary without deciding its evaluator is a compile error. `null` marks a
 * law whose channel does not exist yet — never a silent pass (see
 * composeLawPipeline).
 */
const LAW_EVALUATORS: Record<LawKey, LawEvaluator | null> = {
  suppression: (f) => (f.suppressed ? 'suppressed' : null),
  bounce_block: (f) => (f.lead.emailUndeliverable ? 'address_undeliverable' : null),
  send_once: (f) => (f.alreadySent ? 'already_sent' : null),
  per_lead_cap: (f) =>
    f.sentToLeadToday >= (f.limits?.leadDailyCap ?? DEFAULT_LEAD_DAILY_CAP) ? 'lead_daily_cap' : null,
  agency_cap: (f) =>
    f.sentByAgencyToday >= (f.limits?.agencyDailyCeiling ?? DEFAULT_AGENCY_DAILY_CEILING) ? 'agency_daily_cap' : null,
  quiet_hours: (f) => (withinQuietHours(f.quietHours, f.now) ? 'quiet_hours' : null),
  // Messaging-channel laws: declared in the vocabulary so actions can name
  // them, unimplemented until B6 brings the channel. No registered action may
  // declare an unimplemented law — asserted in CI.
  opt_out: null,
  window_24h: null,
}

/**
 * Whether the action's recipient requirement is satisfiable from the facts.
 * Sparse on purpose: most field types are never recipients. `phone` arrives
 * with the first messaging action (B6).
 */
const RECIPIENT_CHECKS: Partial<Record<FieldType, LawEvaluator>> = {
  email: (f) => (!f.lead.email?.trim() ? 'no_email' : null),
}

type PipelineStep = { kind: 'law'; law: LawKey } | { kind: 'requires' }

/**
 * The canonical evaluation order. The `requires` step sits exactly where the
 * pre-B2 `no_email` check sat — between suppression and bounce_block — so the
 * composed pipeline is byte-identical to the sequence it replaces.
 */
const PIPELINE_ORDER: readonly PipelineStep[] = [
  { kind: 'law', law: 'suppression' },
  { kind: 'requires' },
  { kind: 'law', law: 'bounce_block' },
  { kind: 'law', law: 'send_once' },
  { kind: 'law', law: 'per_lead_cap' },
  { kind: 'law', law: 'agency_cap' },
  { kind: 'law', law: 'quiet_hours' },
  { kind: 'law', law: 'opt_out' },
  { kind: 'law', law: 'window_24h' },
]

export type ComposedPipeline = {
  steps: readonly LawEvaluator[]
  /** Declared laws with no evaluator yet. CI asserts this is always empty. */
  unimplemented: readonly LawKey[]
}

/**
 * Build the ordered evaluator list for one action's declared laws and
 * recipient requirements. Pure; no catalog lookup, no I/O.
 */
export function composeLawPipeline(laws: readonly LawKey[], requires: readonly FieldType[]): ComposedPipeline {
  const declared = new Set<LawKey>(laws)
  const steps: LawEvaluator[] = []
  const unimplemented: LawKey[] = []

  for (const step of PIPELINE_ORDER) {
    if (step.kind === 'requires') {
      for (const type of requires) {
        const check = RECIPIENT_CHECKS[type]
        if (check) steps.push(check)
      }
      continue
    }
    if (!declared.has(step.law)) continue
    const evaluator = LAW_EVALUATORS[step.law]
    if (evaluator) steps.push(evaluator)
    else unimplemented.push(step.law)
  }

  return { steps, unimplemented }
}

/** Engine-level invariants. Not catalog-declared, not opt-out-able. */
function universalGuards(f: SendFacts): LawDecision | null {
  if (f.event.origin === 'import') return skip('origin_import')
  if (!f.lead.exists) return skip('lead_deleted')
  if (f.event.trigger === 'lead_created' && isTerminalStatus(f.lead.currentStatus)) return skip('premise_expired')
  if (f.event.trigger === 'status_changed' && f.expectedStatus != null && f.lead.currentStatus !== f.expectedStatus)
    return skip('premise_expired')
  return null
}

/**
 * Evaluate an action's composed pipeline. An action that declares a law we
 * cannot yet evaluate FAILS CLOSED — never a silent send.
 */
export function decideSendForAction(
  action: { laws: readonly LawKey[]; requires: readonly FieldType[] },
  f: SendFacts,
): LawDecision {
  const guarded = universalGuards(f)
  if (guarded) return guarded

  const { steps, unimplemented } = composeLawPipeline(action.laws, action.requires)
  if (unimplemented.length > 0) return skip('action_unavailable')

  for (const step of steps) {
    const reason = step(f)
    if (reason) return skip(reason)
  }
  return { allow: true }
}

/**
 * The shipped email path, preserved verbatim for every existing caller. It is
 * now an ADAPTER over the composed pipeline, sourcing its laws from the
 * catalog's `email.send` entry rather than from a hardcoded sequence.
 *
 * If the catalog entry were ever missing, this fails closed rather than
 * sending unguarded — a state CI makes unreachable.
 */
export function decideSend(f: SendFacts): LawDecision {
  const action = getAction('email.send')
  if (!action) return skip('action_unavailable')
  return decideSendForAction(action, f)
}

/**
 * Send-once claim key (ADR-005). The trailing 'ever' is the explicit
 * semantics component required by ADR-005/ADR-008: a future per-entry option
 * writes keys under a NEW semantics value — historical claims are never
 * reinterpreted.
 */
export function sendOnceKey(automationId: number, leadId: number): string {
  return `auto:${automationId}:lead:${leadId}:ever`
}

/**
 * Definition source-filter matching, applied at EMISSION (the event carries
 * leadSource; jobs deliberately don't persist it — a non-matching definition
 * simply never gets a job). Null filter matches everything; a set filter
 * prefix-matches the lead's source (rows store provider-prefixed values like
 * 'facebook:{id}'). Events without a leadSource (status_changed) match only
 * filterless definitions.
 */
export function sourceFilterMatches(filter: string | null, leadSource: string | null | undefined): boolean {
  if (filter == null || filter.trim() === '') return true
  if (!leadSource) return false
  return leadSource === filter || leadSource.startsWith(`${filter}:`)
}
