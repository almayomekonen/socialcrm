import { appointmentBlock, type MeetingFacts } from './appointments'
import type { AutomationTriggerEvent, LawDecision, SkipReason } from './types'
import { TERMINAL_LEAD_STATUSES } from './types'
import { withinQuietHours, type QuietHoursConfig } from './timing'
import { liveConditionsHold, type FieldValues } from './conditionEvaluator'
import type { Condition } from './conditions'
import type { EventDefinition } from './catalog/types'
import type { FieldType, LawKey } from './catalog/vocabularies'

/**
 * The engine's laws — pure decisions over gathered facts, no I/O (the IRE
 * decideEligibility shape). The worker gathers SendFacts and calls
 * decideSendForAction as the authoritative pre-effect check; call sites
 * additionally never enqueue import-origin events (Phase 3), so the origin law
 * here is the second, unconditional layer of the same rule.
 *
 * B5 deleted the `decideSend()` email adapter that stood here: the worker now
 * resolves the automation's action and asks about THAT action, so there is no
 * longer an email-shaped entry point to preserve.
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
  /**
   * B6: the automation's premise, as CONDITIONS rather than a status column.
   * Live-freshness conditions are re-read from the subject at this moment and
   * must still hold; `premise_expired` is what it means when they do not.
   * Snapshot conditions were already decided at emission (their value cannot
   * have changed since), so they are deliberately not re-evaluated here.
   */
  premise?: { definition: EventDefinition | null; conditions: readonly Condition[]; values: FieldValues } | null
  lead: {
    exists: boolean
    currentStatus: string | null
  }
  /**
   * B6b — delivery targets, keyed by the SUBJECT FIELD the action's `requires`
   * resolved to, replacing the email-shaped `lead.email` /
   * `lead.emailUndeliverable` pair.
   *
   * The recipient laws below read this map rather than a named address, so an
   * action that delivers to a phone, a webhook URL or nobody at all is decided
   * by the same code — and adding one costs no line here.
   */
  recipients?: Record<string, { value: string | null; blocked: boolean }>
  /**
   * The appointment occurrence's live state, when this job is one. Gathered by
   * the worker; absent for every other trigger.
   */
  appointment?: MeetingFacts | null
  suppressed: boolean
  /**
   * Messaging-channel consent — the lead asked this business to stop. Distinct
   * from `suppressed`, which is email unsubscribe: two channels, two consents.
   * Absent for actions that declare no `opt_out` law, which never read it.
   */
  optedOut?: boolean
  alreadySent: boolean // send-once claim already recorded (ADR-005)
  /**
   * Automated messages this lead received today, from EVERY automated sender —
   * this engine's automations AND the instant-response engine. One number,
   * because the cap protects the lead, and a lead who was already messaged by a
   * machine today has been messaged whichever subsystem did it.
   */
  sentToLeadToday: number
  sentByAgencyToday: number // automated messages this business sent today
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
  // Any resolved recipient that is undeliverable blocks the action. Generic
  // over recipients; an action that declares no recipient never trips it.
  bounce_block: (f) => (Object.values(f.recipients ?? {}).some((r) => r.blocked) ? 'address_undeliverable' : null),
  send_once: (f) => (f.alreadySent ? 'already_sent' : null),
  per_lead_cap: (f) => (f.sentToLeadToday >= (f.limits?.leadDailyCap ?? DEFAULT_LEAD_DAILY_CAP) ? 'lead_daily_cap' : null),
  agency_cap: (f) =>
    f.sentByAgencyToday >= (f.limits?.agencyDailyCeiling ?? DEFAULT_AGENCY_DAILY_CEILING) ? 'agency_daily_cap' : null,
  quiet_hours: (f) => (withinQuietHours(f.quietHours, f.now) ? 'quiet_hours' : null),
  /**
   * Messaging-channel opt-out. The lead asked this business to stop, so no
   * automated message goes out on a messaging channel — regardless of which
   * automation, and regardless of email consent, which is a separate question
   * answered by `suppression`.
   */
  opt_out: (f) => (f.optedOut ? 'opted_out' : null),
  /**
   * The WhatsApp 24-hour customer-service window, and deliberately still
   * unimplemented.
   *
   * `whatsapp.send` is TEMPLATE-ONLY, and an approved template delivers whether
   * the window is open or closed — that is precisely what templates are for. So
   * the window is not a gate the shipped messaging action can trip, and an
   * evaluator for it would be dead code pretending to be a safeguard.
   *
   * It stays declared for the FREE-TEXT messaging action that does not exist
   * yet, which genuinely cannot send outside the window. When that action
   * arrives it declares this law, CI refuses it until an evaluator exists, and
   * the evaluator is written then — against a real caller. That gate is the
   * reason this line is `null` rather than a guess.
   */
  window_24h: null,
}

/**
 * The skip reason for "this action needs a recipient of type X and there is
 * none". Persisted values, so append-only: a new channel appends its reason
 * rather than reusing another channel's.
 *
 * An unmapped type is NOT silently allowed — `requiresStep` fails closed with
 * `action_unavailable`, because an action whose recipient requirement cannot
 * even be named must never resolve to a send.
 */
const MISSING_RECIPIENT: Partial<Record<FieldType, SkipReason>> = {
  email: 'no_email',
  phone: 'no_phone',
}

/**
 * Whether the action's recipient requirements are satisfiable from the facts.
 * Reads the generic `recipients` map, keyed by the SUBJECT FIELD each
 * requirement resolved to — so this function names no channel.
 */
function requiresStep(requires: readonly FieldType[], fieldForType: RecipientFieldLookup): LawEvaluator[] {
  return requires.map((type) => (f: SendFacts) => {
    const reason = MISSING_RECIPIENT[type]
    if (!reason) return 'action_unavailable'
    const key = fieldForType(type)
    const value = key ? f.recipients?.[key]?.value : null
    return value?.trim() ? null : reason
  })
}

/**
 * Maps an action's required FIELD TYPE to the subject field key that carries
 * it on this event. Supplied by the caller because only the event knows.
 */
export type RecipientFieldLookup = (type: FieldType) => string | null

/** The default when no event is available: the type doubles as the key. */
const typeAsKey: RecipientFieldLookup = (type) => type

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
export function composeLawPipeline(
  laws: readonly LawKey[],
  requires: readonly FieldType[],
  fieldForType: RecipientFieldLookup = typeAsKey,
): ComposedPipeline {
  const declared = new Set<LawKey>(laws)
  const steps: LawEvaluator[] = []
  const unimplemented: LawKey[] = []

  for (const step of PIPELINE_ORDER) {
    if (step.kind === 'requires') {
      steps.push(...requiresStep(requires, fieldForType))
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
  const appointment = appointmentGuard(f)
  if (appointment) return appointment
  if (!premiseHolds(f)) return skip('premise_expired')
  return null
}

/**
 * The appointment invariant — three things that must still be true of the
 * meeting before a reminder about it may go out: it exists, it was not
 * cancelled, and it has not already started.
 *
 * ENGINE-LEVEL, deliberately not a customer condition. A reminder that fires for
 * a deleted or cancelled meeting, or one already under way, is wrong in a way
 * the customer cannot be asked to guard against — so it must not be expressible
 * as a condition they could delete. Same reasoning as the `lead_created`
 * terminal-status check above, and the same shape.
 *
 * Only applies when the facts were gathered, which the worker does exactly for
 * appointment jobs. A trigger with no appointment facts is unaffected.
 */
function appointmentGuard(f: SendFacts): LawDecision | null {
  if (f.event.trigger !== 'appointment_booked') return null
  // Facts absent for an appointment job means the occurrence could not be read
  // at all — fail closed rather than remind about an unknown meeting.
  if (!f.appointment) return skip('meeting_missing')
  const block = appointmentBlock(f.appointment, f.now)
  return block ? skip(block) : null
}

/**
 * The premise check, generalised. It replaces the hardcoded
 * `currentStatus !== targetStatus` comparison with evaluation of whatever
 * live-freshness conditions the automation actually declares — which, for
 * every automation written before B6, IS that comparison.
 *
 * An automation whose event the catalog cannot describe has an
 * unevaluatable premise and fails CLOSED.
 */
function premiseHolds(f: SendFacts): boolean {
  const premise = f.premise
  if (!premise) return true
  if (!premise.definition) return premise.conditions.length === 0
  return liveConditionsHold(premise.definition, premise.conditions, premise.values).pass
}

/**
 * Evaluate an action's composed pipeline. An action that declares a law we
 * cannot yet evaluate FAILS CLOSED — never a silent send.
 */
export function decideSendForAction(
  action: { laws: readonly LawKey[]; requires: readonly FieldType[] },
  f: SendFacts,
  fieldForType: RecipientFieldLookup = typeAsKey,
): LawDecision {
  const guarded = universalGuards(f)
  if (guarded) return guarded

  const { steps, unimplemented } = composeLawPipeline(action.laws, action.requires, fieldForType)
  if (unimplemented.length > 0) return skip('action_unavailable')

  for (const step of steps) {
    const reason = step(f)
    if (reason) return skip(reason)
  }
  return { allow: true }
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
