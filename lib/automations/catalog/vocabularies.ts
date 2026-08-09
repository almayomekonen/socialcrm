/**
 * Automation Builder catalog — CLOSED VOCABULARIES.
 *
 * Frozen architecture: docs/customer-automation-builder-final.md §3, §5.
 *
 * Law 3: every vocabulary here is APPEND-ONLY. A value may be added
 * deliberately, for everyone; a value is never renamed or removed, because
 * catalog keys and their values are persisted on automations.
 *
 * Law 4: no integration may add a parameter type, a validator, a preview
 * shape, or a law. These sets grow for everyone or not at all.
 */

// ── Event (§3.4) ────────────────────────────────────────────────────────────

/** Who produces the event. Derived events need an evaluation-day anchor. */
export const EVENT_ORIGINS = ['external', 'internal', 'derived'] as const
export type EventOrigin = (typeof EVENT_ORIGINS)[number]

export const EVENT_LIFECYCLES = ['stable', 'beta', 'deprecated'] as const
export type EventLifecycle = (typeof EVENT_LIFECYCLES)[number]

// ── Field (§3.6) ────────────────────────────────────────────────────────────

export const FIELD_TYPES = [
  'text',
  'number',
  'boolean',
  'enum',
  'date',
  'datetime',
  'email',
  'phone',
  'money',
  'url',
  'reference',
] as const
export type FieldType = (typeof FIELD_TYPES)[number]

/**
 * `snapshot` = the value as of the event. `live` = re-read from the subject at
 * execution time. Conditions evaluate at execution and honour this (Law 6) —
 * without it, a condition on a three-week-delayed anchored send reads stale
 * data and is meaningless.
 */
export const FIELD_FRESHNESS = ['snapshot', 'live'] as const
export type FieldFreshness = (typeof FIELD_FRESHNESS)[number]

export const FIELD_LIFECYCLES = ['stable', 'deprecated'] as const
export type FieldLifecycle = (typeof FIELD_LIFECYCLES)[number]

/** Only these field types can anchor timing (§7 of the frozen spec). */
export const ANCHORABLE_FIELD_TYPES: readonly FieldType[] = ['datetime'] as const

// ── Conditions (§6 domain model) ────────────────────────────────────────────

export const CONDITION_OPERATORS = [
  'is',
  'is_not',
  'contains',
  'is_one_of',
  'equals',
  'greater_than',
  'less_than',
  'before',
  'after',
  'between',
  'exists',
  'not_exists',
  'is_true',
  'is_false',
] as const
export type ConditionOperator = (typeof CONDITION_OPERATORS)[number]

/**
 * Operators are DERIVED from field type, never hand-authored per event. This
 * map is what makes "add a field, get conditions for free" true.
 */
export const OPERATORS_BY_FIELD_TYPE: Record<FieldType, readonly ConditionOperator[]> = {
  text: ['is', 'is_not', 'contains'],
  number: ['equals', 'greater_than', 'less_than'],
  money: ['equals', 'greater_than', 'less_than'],
  boolean: ['is_true', 'is_false'],
  enum: ['is', 'is_not', 'is_one_of'],
  date: ['before', 'after', 'between'],
  datetime: ['before', 'after', 'between'],
  email: ['exists', 'not_exists'],
  phone: ['exists', 'not_exists'],
  url: ['exists', 'not_exists'],
  reference: ['is', 'is_not'],
}

// ── Parameters (§3.7) — CLOSED SET ──────────────────────────────────────────

export const PARAMETER_TYPES = [
  'text',
  'number',
  'boolean',
  'date',
  'enum_static',
  /** Options come from connection.options(sourceKey) — the generic picker. */
  'enum_remote',
  'reference',
  /**
   * Options come from the AGENCY'S OWN data — no connection, no capability, no
   * connector. A separate type rather than a flavour of `enum_remote`, and the
   * distinction is load-bearing rather than cosmetic:
   *
   *   · `binding.ts` writes every EVENT `enum_remote` answer into `sourceIds`,
   *     the connection binding. A first-party answer is not a connector Source
   *     and must never land there. Because that code filters on
   *     `type === 'enum_remote'`, this type is STRUCTURALLY excluded — the
   *     binding needs no edit and cannot be got wrong.
   *   · `needsConnection()` would otherwise report an event as requiring a
   *     connection it does not need.
   *   · every `enum_remote` resolution door ends at
   *     `providerForConnection(connectionId)`; with no connection it answers
   *     `[]` silently, which is indistinguishable from "you have none".
   *
   * `optionSource` names a key from `FIRST_PARTY_SOURCES` below — a closed,
   * server-owned set, so a client can never ask for an arbitrary source.
   */
  'enum_agency',
] as const
export type ParameterType = (typeof PARAMETER_TYPES)[number]

/**
 * The agency-owned data sets a parameter may select from. CLOSED and
 * append-only, exactly like every vocabulary here.
 *
 * Closed for a security reason as well as an architectural one: the Builder
 * forwards a parameter's declared `optionSource` to a Server Action, and that
 * action refuses anything absent from this list. The client therefore chooses
 * among server-defined sources rather than naming one.
 *
 * Each entry MUST have a loader in `lib/automations/firstPartyOptions.ts`;
 * that record is typed over this union, so adding a key without a loader is a
 * compile error rather than an empty dropdown.
 */
export const FIRST_PARTY_SOURCES = ['quote_templates'] as const
export type FirstPartySource = (typeof FIRST_PARTY_SOURCES)[number]

/** Validation is DATA, never code (§3.7). */
export const PARAMETER_VALIDATORS = ['required', 'maxLength', 'min', 'max', 'pattern', 'oneOf'] as const
export type ParameterValidator = (typeof PARAMETER_VALIDATORS)[number]

// ── Requirements (§3.4/§3.5) ────────────────────────────────────────────────

/**
 * Three gates, three different user experiences:
 *   connection  → shown locked, with a connect CTA
 *   entitlement → shown locked, linking to billing (never an in-context upsell)
 *   flag        → hidden entirely
 */
export const REQUIREMENT_TYPES = ['connection', 'entitlement', 'flag'] as const
export type RequirementType = (typeof REQUIREMENT_TYPES)[number]

// ── Actions (§3.5, §3.8, §3.9) ──────────────────────────────────────────────

export const ACTION_RISKS = ['internal', 'external', 'irreversible'] as const
export type ActionRisk = (typeof ACTION_RISKS)[number]

/** Closed preview shapes — the Builder renders these, never per-channel UI. */
export const PREVIEW_SHAPES = ['email', 'message', 'record', 'none'] as const
export type PreviewShape = (typeof PREVIEW_SHAPES)[number]

/**
 * Law keys, declared PER ACTION (§3.8). A suppressed lead must still get a
 * task created for the rep — suppression is consent not to be *contacted*,
 * which says nothing about internal record-keeping.
 */
export const LAW_KEYS = [
  'send_once',
  'per_lead_cap',
  'agency_cap',
  /** Email opt-out. Channel-specific by design (engine prerequisite #1). */
  'suppression',
  'bounce_block',
  'quiet_hours',
  /** Messaging-channel opt-out, distinct from email suppression. */
  'opt_out',
  /** WhatsApp 24-hour free-text window. */
  'window_24h',
] as const
export type LawKey = (typeof LAW_KEYS)[number]

// ── Integration / Connection / Source (§3.1–§3.3) ───────────────────────────

export const AUTH_STRATEGIES = ['oauth2', 'api_key', 'embedded_signup', 'none'] as const
export type AuthStrategy = (typeof AUTH_STRATEGIES)[number]

export const CONNECTION_HEALTH = ['ok', 'needs_reauth', 'degraded', 'revoked'] as const
export type ConnectionHealth = (typeof CONNECTION_HEALTH)[number]

export const SOURCE_SUBSCRIPTION_STATES = ['subscribed', 'pending', 'failed'] as const
export type SourceSubscriptionState = (typeof SOURCE_SUBSCRIPTION_STATES)[number]

// ── Keys ────────────────────────────────────────────────────────────────────

/** Namespaced, lowercase, dot-separated: `appointment.booked`, `email.send`. */
export const CATALOG_KEY_PATTERN = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/

/** Single-segment keys for integrations, subjects, capabilities, laws. */
export const SIMPLE_KEY_PATTERN = /^[a-z][a-z0-9_]*$/
