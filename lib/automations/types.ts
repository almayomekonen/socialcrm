/**
 * CUSTOMER AUTOMATION ENGINE — closed vocabularies (ADR-001, ADR-004).
 *
 * Customer-side domain: businesses automating email to their leads. Must never
 * import from the platform-email domain (lib/emailAutomations and its stores)
 * — boundary contract in docs/email-automations-plan.md §0, enforced by
 * __tests__/automations/boundary.test.ts.
 *
 * These enums are persisted data once Phase 2 lands (ADR-008): values are
 * append-only; renames are migrations. An engine reading an unknown value
 * holds the automation inert — it never guesses.
 */

export const TRIGGER_TYPES = ['lead_created', 'status_changed'] as const
export type TriggerType = (typeof TRIGGER_TYPES)[number]

// Emission provenance (ADR-004): ALWAYS supplied explicitly by the call site,
// never inferred — the CSV import path reuses the manual-creation action, so
// inference would fire automations on bulk imports. Origin is NOT the lead's
// `source` field: origin says how the event entered the engine; `source` is
// what users filter on in automation conditions.
export const TRIGGER_ORIGINS = ['webhook_facebook', 'webhook_whatsapp', 'manual', 'import'] as const
export type TriggerOrigin = (typeof TRIGGER_ORIGINS)[number]

export const ACTION_TYPES = ['send_email'] as const
export type ActionType = (typeof ACTION_TYPES)[number]

// Lead statuses the engine treats as terminal (mirrors the IRE worker's rule).
export const TERMINAL_LEAD_STATUSES = ['closed', 'lost'] as const

export type AutomationTriggerEvent = {
  trigger: TriggerType
  origin: TriggerOrigin
  agencyId: number
  leadId: number
  occurredAt: Date
  // The lead's source field at emission time (condition filtering input).
  leadSource?: string | null
  // status_changed only: the status the lead moved into.
  newStatus?: string | null
}

// Every way a law can decline to send. Persisted on activity-log rows (Phase
// 2+); append-only. Hebrew user copy for each lives in ./copy.ts — one map,
// exhaustively tested.
export const SKIP_REASONS = [
  'origin_import', // imports never trigger (ADR-004, ADR-006)
  'lead_deleted', // lead gone before the send moment
  'premise_expired', // the state that justified the send no longer holds
  'suppressed', // lead unsubscribed from this business's automated email
  'no_email', // lead has no email address
  'address_undeliverable', // hard-bounced address
  'already_sent', // send-once: this automation already reached this lead (ADR-005)
  'lead_daily_cap', // per-lead frequency cap reached today
  'agency_daily_cap', // engine-level daily ceiling for the business reached
  'quiet_hours', // inside the configured no-send window
] as const
export type SkipReason = (typeof SKIP_REASONS)[number]

export type LawDecision = { allow: true } | { allow: false; reason: SkipReason }
