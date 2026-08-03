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

// B7 appends `appointment_booked` — the first EXTERNAL event. It names an
// occurrence, not an integration: a Calendly booking and a Google Calendar
// booking are the same engine trigger, distinguished only by their connector.
export const TRIGGER_TYPES = ['lead_created', 'status_changed', 'appointment_booked', 'form_submitted'] as const
export type TriggerType = (typeof TRIGGER_TYPES)[number]

// Emission provenance (ADR-004): ALWAYS supplied explicitly by the call site,
// never inferred — the CSV import path reuses the manual-creation action, so
// inference would fire automations on bulk imports. Origin is NOT the lead's
// `source` field: origin says how the event entered the engine; `source` is
// what users filter on in automation conditions.
// The two per-provider webhook origins are GRANDFATHERED: they predate the
// connector layer and are persisted on live rows, so they stay forever
// (append-only). Every connector from B7 onward uses the generic `webhook`,
// which is why adding an integration never again touches this vocabulary.
export const TRIGGER_ORIGINS = ['webhook_facebook', 'webhook_whatsapp', 'webhook', 'manual', 'import'] as const
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
  /**
   * B7: the event's snapshot payload, keyed by CATALOG field key — what a
   * connector's `mapEvent()` produces. `leadSource` / `newStatus` above are the
   * two internal events' pre-catalog spellings of the same idea and are kept
   * because they are the persisted ADR-010 shape.
   */
  fields?: Record<string, unknown> | null
  /**
   * B7: the connector's own occurrence identity (ADR-010). Internal events
   * derive theirs in `eventKeyFor`; an external event knows its own.
   */
  occurrenceKey?: string | null
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
  // B6b appends the messaging counterpart. Nothing produces it yet — it exists
  // so the FIRST messaging action is a catalog entry plus an executor, with no
  // engine edit to invent a reason for a missing recipient.
  'no_phone', // lead has no phone number
  'address_undeliverable', // hard-bounced address
  'already_sent', // send-once: this automation already reached this lead (ADR-005)
  'lead_daily_cap', // per-lead frequency cap reached today
  'agency_daily_cap', // engine-level daily ceiling for the business reached
  'quiet_hours', // inside the configured no-send window
  // B2: the action's declared law set cannot be fully evaluated (a law
  // whose channel does not exist yet, or a missing catalog entry). Fails
  // CLOSED so an unevaluatable pipeline can never become a silent send.
  // CI asserts no registered action can produce this.
  'action_unavailable',
] as const
export type SkipReason = (typeof SKIP_REASONS)[number]

export type LawDecision = { allow: true } | { allow: false; reason: SkipReason }
