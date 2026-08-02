import type {
  ActionRisk,
  AuthStrategy,
  ConnectionHealth,
  EventLifecycle,
  EventOrigin,
  FieldFreshness,
  FieldLifecycle,
  FieldType,
  LawKey,
  ParameterType,
  PreviewShape,
  RequirementType,
  SourceSubscriptionState,
} from './vocabularies'

/**
 * Automation Builder catalog — THE CONTRACTS.
 *
 * Frozen architecture: docs/customer-automation-builder-final.md §3, §6.
 *
 * These declarations are the entire extensibility surface. Everything the
 * Builder can do, it learns from here. Adding an integration means adding
 * catalog DATA — never Builder code (Law 1).
 *
 * Metadata describes; code executes (§4 Q4). Nothing in this file executes.
 */

// ── Shared ──────────────────────────────────────────────────────────────────

/** A gate on an event or action. Each type has one generic renderer. */
export type Requirement = {
  type: RequirementType
  /** Capability / entitlement / flag key being required. */
  key: string
  /** Where to send the user to satisfy it. Data, never per-integration code. */
  cta?: { label: string; href: string }
}

/** Declarative validation for a parameter. Data, never code (§3.7). */
export type ParameterValidation = {
  required?: boolean
  maxLength?: number
  min?: number
  max?: number
  /** Serialised regex source — validated at build time. */
  pattern?: string
  oneOf?: readonly string[]
}

/**
 * A user-answerable input on an event or action. `enum_remote` is the
 * workhorse: a Shopify product picker, a Calendly calendar picker and a
 * Facebook page picker are the SAME control with different providers.
 */
export type ParameterDefinition = {
  key: string
  type: ParameterType
  label: string
  help?: string
  validation?: ParameterValidation
  /** enum_static only. */
  options?: readonly { value: string; label: string }[]
  /**
   * enum_remote only — the key passed to `connection.options(sourceKey)`.
   * The Builder never learns what the options mean.
   */
  optionSource?: string
}

/**
 * A piece of data an event exposes. THE bridge: conditions, message variables
 * and timing anchors are all derived from these (§1).
 */
export type FieldDefinition = {
  key: string
  type: FieldType
  label: string
  freshness: FieldFreshness
  lifecycle: FieldLifecycle
  /** enum only. */
  options?: readonly { value: string; label: string }[]
}

// ── Catalog entities (§6) ───────────────────────────────────────────────────

/** Grouping for the event picker. Closed catalog; grows deliberately. */
export type SubjectDefinition = {
  key: string
  title: string
  icon: string
}

export type IntegrationDefinition = {
  key: string
  title: string
  icon: string
  auth: AuthStrategy
  /** What connecting unlocks — used for connect CTA copy. */
  capabilities: readonly string[]
}

export type EventDefinition = {
  key: string
  origin: EventOrigin
  /** References a SubjectDefinition.key. */
  subject: string
  title: string
  description: string
  icon: string
  category?: string
  lifecycle: EventLifecycle
  requirements: readonly Requirement[]
  parameters: readonly ParameterDefinition[]
  fields: readonly FieldDefinition[]
  identity: {
    /** How ONE occurrence is distinguished from another (ADR-010). */
    occurrenceKey: string
    /**
     * How this event resolves to exactly one subject Lead (Law 2). An event
     * that cannot resolve to a Lead cannot exist — the engine's laws are all
     * lead-keyed. Declaring it here makes the obligation reviewable and CI
     * -checkable rather than discovered at implementation time.
     */
    leadResolution: string
  }
}

export type ActionDefinition = {
  key: string
  title: string
  description: string
  icon: string
  requirements: readonly Requirement[]
  /**
   * Field types the subject must expose for this action to be offered.
   * `['email']` for email, `['phone']` for messaging, `[]` for internal
   * actions. This × an event's `fields` is what makes actions self-filtering
   * without any per-channel Builder logic.
   */
  requires: readonly FieldType[]
  parameters: readonly ParameterDefinition[]
  /** Declared per action (§3.8). The engine composes its pipeline from this. */
  laws: readonly LawKey[]
  risk: ActionRisk
  preview: PreviewShape
  /** Whether "שלח אליי בדיקה" is offered for this action. */
  testable: boolean
}

/** Documents a law so the catalog can be validated and the UI can explain it. */
export type LawDefinition = {
  key: LawKey
  title: string
  description: string
}

// ── Runtime entities (§3.2, §3.3) — contracts only in B0 ────────────────────

export type ConnectionOption = { id: string; label: string }

/**
 * One authorisation of one integration for one agency.
 *
 * `id` MUST be stable across re-authorisation — a connector obligation. If a
 * reconnect mints a new id, every automation bound to it breaks.
 */
export type Connection = {
  id: string
  integrationKey: string
  agencyId: number
  displayName: string
  health: ConnectionHealth
}

/**
 * One subscribable stream within a connection: a page, a calendar, a phone
 * number, a store, a form. Webhook subscription and stream health attach
 * HERE, not to the connection — the shipped code already subscribes per
 * Facebook page and per WhatsApp WABA.
 *
 * Users never see the word "Source": it renders as an enum_remote parameter.
 */
export type Source = {
  id: string
  connectionId: string
  label: string
  subscription: SourceSubscriptionState
  health: ConnectionHealth
}

// ── Connector contract (§4 Q2) ──────────────────────────────────────────────

/**
 * What every connector implements. Plugin SHAPE, deliberately not a plugin
 * RUNTIME — connectors are statically registered modules, so we get the
 * architectural benefit without sandboxing, versioning and security risk.
 *
 * Declared in B0 as a type only; no connector implements it until B4+.
 */
export type ConnectorContract = {
  integrationKey: string
  listSources(connection: Connection): Promise<Source[]>
  verifyWebhook(input: { headers: Record<string, string>; body: string }): boolean
  /** Provider payload → engine event occurrence, or null to ignore. */
  mapEvent(input: { sourceId: string; body: unknown }): Promise<{ eventKey: string; data: Record<string, unknown> } | null>
  /** MUST resolve to exactly one lead, before the engine sees the event. */
  resolveSubject(input: { agencyId: number; data: Record<string, unknown> }): Promise<number | null>
  options(connection: Connection, sourceKey: string): Promise<ConnectionOption[]>
  health(connection: Connection): Promise<ConnectionHealth>
}

// ── The catalog as a whole ──────────────────────────────────────────────────

export type Catalog = {
  subjects: readonly SubjectDefinition[]
  integrations: readonly IntegrationDefinition[]
  events: readonly EventDefinition[]
  actions: readonly ActionDefinition[]
  laws: readonly LawDefinition[]
}
