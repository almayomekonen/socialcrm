/**
 * Notification domain vocabulary — spec §4 (taxonomy), §5 (registry contract),
 * §7 (priority/presence), §18 (storage shapes).
 *
 * Every string literal here matches a database CHECK constraint exactly, so a
 * value that typechecks is a value the database will accept. Lowercase because
 * that is what the migrations declare. (`type` and `entityType` themselves have
 * no CHECK; the category, priority, channel and status literals do.)
 *
 * NOTE ON SIZE (architecture-rules.md §6): over the 250-line soft limit on
 * purpose, for the same reason as registry.ts — one vocabulary whose members
 * are documented side by side; splitting it would scatter the contract.
 */

/**
 * The types. Spec §4 — the registry (registry.ts) holds one entry per type.
 *
 * `subscription.cancellation_requested` is the one PLATFORM-level member. Every
 * other type tells an agency about its own work; this one tells the platform
 * operator that a customer cancelled and a standing order at the payment
 * provider still needs stopping by hand. It rides the same engine because the
 * engine is generic — only its recipient rule differs (see RecipientRule).
 */
export const NOTIFICATION_TYPES = [
  'lead.created',
  'lead.hot',
  'lead.assigned',
  /** One summary for a bulk assignment, addressed to the receiving rep. */
  'lead.bulk_assigned',
  'lead.status_changed',
  'lead.activity',
  'message.inbound',
  'message.inbound_multiple',
  'message.unanswered',
  /**
   * The AI handed a WhatsApp conversation to a person (the customer asked for
   * one, or qualification finished) and no person has answered since. Emitted
   * by the unanswered tick, never at the handoff site, so AI-worker retries and
   * concurrent jobs cannot duplicate it. Questionnaire handoffs keep
   * `lead.questionnaire_handoff`.
   */
  'lead.handoff',
  /** Its own type, not message.inbound: Messenger has its own tables, links and recipients. */
  'message.messenger_inbound',
  'comment.received',
  'followup.due',
  'followup.overdue',
  'integration.disconnected',
  'integration.error',
  'integration.ingestion_failed',
  'sla.approaching',
  'sla.breached',
  'subscription.cancellation_requested',
  /**
   * A deterministic WhatsApp questionnaire finished, or stopped and is waiting
   * for a person. Its own type rather than `lead.hot`, which means something
   * else: this one carries no judgement about the lead, only the fact that a
   * set of answers is sitting there and nobody has looked at it yet.
   */
  'lead.questionnaire_handoff',
  /**
   * The one AI-originated type. Emitted ONLY by a conclusion that passed the
   * deterministic Value Bar and every condition of the Vigilance Notification
   * Exception (ai-safety-boundaries.md §9.1, DA-001). Its registry entry ships
   * `enabled: false`, so this member is inert until deliberately turned on.
   */
  'lead.insight',
  /**
   * The owner's own personal WhatsApp reminder was DEFINITELY not delivered
   * (Reminder Engine R9): Meta rejected it, Meta later reported it failed, or the
   * send gate refused it (too late, the 24-hour window, a cap, pricing). Owner only.
   */
  'followup.reminder_failed',
  /**
   * The outcome of the owner's personal reminder is UNKNOWN: it may have reached
   * Meta, and SocialCRM never resends it automatically. Never worded as a failure.
   */
  'followup.reminder_unconfirmed',
  /**
   * The conversational auto-response read a WhatsApp conversation as PERSONAL
   * and is answering it. Once per conversation, in-app only, low priority: the
   * owner can see it and take over. Never emitted for a conversation the owner
   * marked personal (that one is never answered at all).
   */
  'conversation.personal_detected',
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

/**
 * Polymorphic, un-foreign-keyed entity reference (spec §18).
 *
 * `subscription` carries the CANCELLING agency's id — the thing the operator has
 * to act on. There is no CHECK constraint on either `entityType` column, so this
 * member is a TypeScript widening only; no migration accompanies it.
 *
 * `lead_assignment` is the AGGREGATE entity, and its id is defined the same way:
 * it carries the id of the REPRESENTATIVE the leads were assigned to. The thing
 * being notified about is not any one lead but "the set of leads assigned to this
 * rep", which is a real, addressable view — `/leads?assignedTo={id}`. It is the
 * only entity type here that stands for a set rather than a row, which is why it
 * needs `aggregate: true` on the type definition rather than passing unnoticed.
 */
// `messenger_conversation` is messenger_conversations.id — a different id space from `conversation`.
// `personal_reminder` is owner_personal_reminders.id (no CHECK on entityType: a TypeScript widening only).
export const ENTITY_TYPES = ['lead', 'conversation', 'integration', 'comment', 'subscription', 'lead_assignment', 'messenger_conversation', 'personal_reminder'] as const
export type EntityType = (typeof ENTITY_TYPES)[number]

/**
 * Recipient rules. Spec §6.1 and amendment 2 (§28).
 *
 * The first two are AGENCY-SCOPED: they resolve inside `job.agencyId` and can
 * never reach outside it, which is what keeps one tenant's notifications inside
 * that tenant.
 *
 * `platform_operator` is deliberately different, and is the only rule that does
 * not consult the agency's own users. It resolves to the platform-owner
 * allowlist (lib/auth/platformOwner.ts) — the same deny-by-default mechanism
 * that already gates /admin — and is for facts that belong to whoever RUNS
 * SocialCRM rather than to anyone who uses it. It is not "the agency's admin"
 * under another name: an agency admin must never receive one of these, and an
 * empty allowlist resolves to nobody rather than falling back to anyone.
 */
/**
 * `reminder_owner` (Reminder Engine R9) is agency-scoped and DATABASE-resolved
 * like the lead rules: the owner of the personal reminder the entity names, read
 * by (agencyId, reminderId) together, never taken from the payload.
 */
export type RecipientRule = 'handler_or_admin' | 'lead_handler_or_admins' | 'admin_only' | 'platform_operator' | 'explicit_user' | 'reminder_owner'

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
   * Persisted `inbox_messages.id` — discriminator for `message.inbound` and
   * `message.unanswered` (latest unanswered inbound head); `messenger_messages.id`
   * for `message.messenger_inbound`. Required for those types; absent elsewhere.
   */
  messageId?: number | null
  /**
   * The user a lead was assigned TO — the `lead.assigned` event-key discriminator.
   * Required for that type; absent elsewhere.
   */
  assignedUserId?: number | null
  /**
   * `lead.handoff`: when the conversation was handed to a person
   * (`conversation_ai_state.escalatedAt`, ISO). The event-key discriminator: one
   * notification per handoff, and a later handoff in the same chat is news.
   */
  escalatedAt?: string | null
  /** `lead.questionnaire_handoff`: did the customer answer every question? */
  complete?: boolean
  /** How many leads one bulk assignment moved. Counted at the emission site. */
  assignedCount?: number | null
  /**
   * Stable digest of the assigned lead-id SET — the batch's identity.
   *
   * A pure function of which leads moved, so it is time- and actor-independent
   * (the collapse-key purity rules) while still separating two different batches
   * to the same rep. Re-emitting the identical batch produces the identical key
   * and therefore collapses instead of duplicating.
   */
  assignmentBatchId?: string | null
  /**
   * Wall-clock of the disconnect transition written to facebook_pages.health_checked_at.
   * Discriminator for `integration.disconnected` so a later reconnect→disconnect
   * episode is news while retries of the same transition stay idempotent.
   */
  disconnectedAt?: number | null
  /**
   * Provider-side lead identity (Meta leadgen id / WhatsApp wamid) for
   * `integration.ingestion_failed`. Required for that type; absent elsewhere.
   */
  externalLeadId?: string | null
  /**
   * Persisted `clients.nextFollowUpAt` as epoch ms — discriminator for
   * `followup.due` / `followup.overdue`. Required for those types; never Date.now().
   */
  followUpAt?: number | null
  /**
   * Facebook Page id for `comment.received` collapse identity
   * (`comment:{pageId}:post:{postId}`). Required for that type; absent elsewhere.
   */
  pageId?: string | null
  /**
   * Facebook post id for `comment.received` collapse identity.
   * Required for that type when present on the row (schema: NOT NULL).
   */
  postId?: string | null
  /**
   * The agency that cancelled — carried explicitly even though it is also the
   * entityId, because for `subscription.cancellation_requested` the event's
   * `agencyId` is the PLATFORM OWNER'S agency (the recipient's tenant), not the
   * cancelling customer's. Without this field the payload would silently read as
   * if the owner had cancelled their own subscription.
   */
  cancellingAgencyId?: number | null
  /** Display name of the cancelling agency. Absent ⇒ name-free copy, never a guess. */
  cancellingAgencyName?: string | null
  /**
   * The PERSISTED `subscriptions.updatedAt` of the false→true transition, epoch
   * ms. The event-key discriminator: a retry of the same cancellation carries
   * the same moment and collapses; a genuine later cancellation carries a new
   * one and is news. Never `Date.now()` — see eventKey.ts.
   */
  cancelledAt?: number | null
  /**
   * `followup.reminder_*`: the reminder's scheduled instant (epoch ms), so the
   * copy names WHICH reminder without carrying its text (the text is purged 90
   * days after a terminal state; a notification must not outlive that).
   */
  remindAtMs?: number | null
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
  /**
   * TRUE ⇒ `entity` names a SET, not a row (§18 extension).
   *
   * Every other type is about one row, and the registry invariants assume it:
   * one collapse identity per entity, one deep link to that row. An aggregate
   * keeps both promises — its entity id is the representative, its collapse key
   * separates by that id, and its link opens that rep's lead view — but the SET
   * it stands for is identified by a batch digest on the payload rather than by
   * a row id. Absent ⇒ per-row, which is every existing type.
   *
   * NOT an exemption from the invariants. An aggregate is still required to
   * separate entities, stay time- and actor-independent, and target its own
   * entity; it simply defines "entity" as the set's owner.
   */
  aggregate?: true
  channels: ChannelPolicy
  /** Absent ⇒ this type NEVER escalates (fail-closed, §9.2 rule 4). */
  escalation?: EscalationLadder
  /** Absent ⇒ this type NEVER escalates (fail-closed, §9.2 rule 4). */
  isResolved?: (row: NotificationRow) => Promise<boolean>
}
