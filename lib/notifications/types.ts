/**
 * Notification domain vocabulary — spec §4 (taxonomy), §5 (registry contract),
 * §7 (priority/presence), §18 (storage shapes).
 *
 * Every string literal here matches a database CHECK constraint exactly, so a
 * value that typechecks is a value the database will accept. Lowercase because
 * that is what the migrations declare.
 */

/** The 15 types. Spec §4 — the registry (registry.ts) holds one entry per type. */
export const NOTIFICATION_TYPES = [
  'lead.created',
  'lead.hot',
  'lead.assigned',
  'lead.status_changed',
  'lead.activity',
  'message.inbound',
  'message.inbound_multiple',
  'message.unanswered',
  'followup.due',
  'followup.overdue',
  'integration.disconnected',
  'integration.error',
  'integration.ingestion_failed',
  'sla.approaching',
  'sla.breached',
] as const

export type NotificationType = (typeof NOTIFICATION_TYPES)[number]

export const NOTIFICATION_CATEGORIES = ['leads', 'messages', 'followups', 'sla', 'integrations'] as const
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number]

export const PRIORITIES = ['critical', 'high', 'medium', 'low', 'info'] as const
export type Priority = (typeof PRIORITIES)[number]

export const CHANNELS = ['in_app', 'toast', 'web_push', 'email'] as const
export type Channel = (typeof CHANNELS)[number]

/** Spec §7.2. Derived server-side from user_presence, never trusted from a client. */
export const PRESENCE_STATES = ['online', 'idle', 'offline'] as const
export type Presence = (typeof PRESENCE_STATES)[number]

/** Polymorphic, un-foreign-keyed entity reference (spec §18). */
export const ENTITY_TYPES = ['lead', 'conversation', 'integration'] as const
export type EntityType = (typeof ENTITY_TYPES)[number]

/** Recipient rules. Exactly two — spec §6.1 and amendment 2 (§28). */
export type RecipientRule = 'handler_or_admin' | 'admin_only'

/**
 * Business facts an emission site already holds, carried to the worker so copy
 * needs no extra query. Every field is optional and every copy builder degrades
 * to a name-free phrasing when one is absent: an absent fact is never guessed
 * (care-charter Law 1).
 */
export type NotificationPayload = {
  /** Lead display name, resolved at the emission site. */
  leadName?: string | null
  /** The status a lead moved INTO. */
  status?: string | null
  /** Integration provider key, e.g. 'facebook' | 'whatsapp'. */
  provider?: string | null
  /** For conversation-entity events, the lead the conversation belongs to. */
  leadId?: number | null
  /**
   * Persisted `inbox_messages.id` — the `message.inbound` event-key discriminator.
   * Required for that type; absent elsewhere.
   */
  messageId?: number | null
  /**
   * The user a lead was assigned TO — the `lead.assigned` event-key discriminator.
   * Required for that type; absent elsewhere.
   */
  assignedUserId?: number | null
}

/**
 * What a registry entry's pure functions read. Assembled by the worker from the
 * job row; contains no database handle, so every builder stays synchronous and
 * unit-testable without a database.
 */
export type EventContext = {
  type: NotificationType
  agencyId: number
  entityType: EntityType
  entityId: number
  /** Null for system-originated events (webhooks, cron) — spec §6.3. */
  actorUserId: number | null
  occurredAt: Date
  payload: NotificationPayload
  /** Events absorbed into one row so far. 1 on first insert; spec §10.2. */
  groupCount: number
}

/** The `notifyEvent()` input. Recipients are NOT part of it — spec §6.2. */
export type NotificationEvent = {
  type: NotificationType
  agencyId: number
  entityType: EntityType
  entityId: number
  actorUserId?: number | null
  occurredAt: Date
  payload?: NotificationPayload
}

/** Channel selection per presence state, before preferences/capabilities (spec §19). */
export type ChannelPolicy = Record<Presence, readonly Channel[]>

/** What a given user can actually receive right now (spec §15.1). */
export type Capabilities = Record<Channel, boolean>

/**
 * A persisted notification. Shaped for the resolution predicates that P4 will
 * add (`isResolved(row)`), which is why it carries createdAt and the entity
 * reference rather than only display fields.
 */
export type NotificationRow = {
  id: number
  agencyId: number
  userId: number
  type: NotificationType
  category: NotificationCategory
  priority: Priority
  title: string
  body: string | null
  entityType: EntityType | null
  entityId: number | null
  deepLink: string
  collapseKey: string
  groupCount: number
  escalationLevel: number
  seenAt: Date | null
  readAt: Date | null
  resolvedAt: Date | null
  createdAt: Date
}

export type EscalationStep = { afterMinutes: number; add: Channel }
/** Ordered channel upgrades to the SAME recipient (spec §12). P4 consumes this. */
export type EscalationLadder = readonly EscalationStep[]

/** Spec §5. A type with `escalation` MUST also declare `isResolved` (invariant 3). */
export type NotificationTypeDef = {
  type: NotificationType
  category: NotificationCategory
  /** false ⇒ registered but never emitted (the sla.* extension point, §4.5). */
  enabled: boolean
  basePriority: Priority
  /** Deterministic dedup identity. Pure function of business facts (§10.3). */
  collapseKey: (ctx: EventContext) => string
  /** Hebrew copy. Deterministic string builders — NEVER an LLM (§5, Law 1). */
  title: (ctx: EventContext) => string
  body: (ctx: EventContext) => string | null
  entity: (ctx: EventContext) => { type: EntityType; id: number }
  /** Targets the ENTITY. Never contains a notification id (§20.2). */
  deepLink: (ctx: EventContext) => string
  recipients: RecipientRule
  channels: ChannelPolicy
  /** Absent ⇒ this type NEVER escalates (fail-closed, §9.2 rule 4). */
  escalation?: EscalationLadder
  /** Absent ⇒ this type NEVER escalates (fail-closed, §9.2 rule 4). */
  isResolved?: (row: NotificationRow) => Promise<boolean>
}
