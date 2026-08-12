/**
 * Event identity — spec §14.3, §21.1.
 *
 * `notification_jobs."eventKey"` is GLOBALLY unique, and the enqueue is
 * `ON CONFLICT DO NOTHING`. Two consequences follow, and both are load-bearing:
 *
 * 1. Webhook retries are absorbed for free. Meta redelivering the same lead
 *    produces the same key and therefore no second notification.
 * 2. The reconciliation sweep (§14.3) is safe to run every minute forever:
 *    re-enqueueing an event that already exists is a no-op, so a job that was
 *    lost to a crash between the lead INSERT and the job INSERT gets picked up
 *    late instead of never.
 *
 * Because the index is on `eventKey` ALONE, the key must carry its own
 * namespace — type, agency and entity. A key of just an entity id would make
 * two different notification types about one lead collide, and the second would
 * silently vanish.
 *
 * Deterministic and pure: never random, never seeded by `Date.now()`. A key that
 * varied per call would defeat both properties above.
 */

import type { NotificationEvent } from './types'

/**
 * The base identity: "this type, for this entity, in this agency".
 *
 * Once-ever per entity per type. For `lead.created` that is exactly right — a
 * lead is created once. For a repeatable occurrence, pass a `discriminator`.
 */
export function eventKeyFor(event: NotificationEvent, discriminator?: string): string {
  const base = `${event.type}:${event.agencyId}:${event.entityType}:${event.entityId}`
  return discriminator ? `${base}:${discriminator}` : base
}

/**
 * A status change is repeatable — a lead can move to 'contacted' twice — so its
 * identity includes the status and the business moment, mirroring the
 * automation engine's `status_changed:{newStatus}:{ms}` rule.
 *
 * Passing the row's OWN timestamp (the value written to statusChangedAt) is what
 * makes a retry idempotent rather than a second notification: same moment, same
 * key. Passing `new Date()` here would break that, which is why the caller
 * supplies `occurredAt`.
 */
export function statusChangedEventKey(event: NotificationEvent): string {
  const status = event.payload?.status ?? 'unknown'
  return eventKeyFor(event, `${status}:${event.occurredAt.getTime()}`)
}

/**
 * An inbound message is repeatable per conversation — every new WhatsApp arrival
 * is news. Identity therefore includes the persisted message row id.
 *
 * WHY `inbox_messages.id`, not `externalId` (wamid) or `(conversationId, sequence)`:
 *
 * - After insert the PK always exists, including when `externalId` is null
 *   (parse miss / non-WhatsApp-shaped payload). A null-externalId discriminator
 *   would silently collapse every such message into one key.
 * - Provider retries that hit the unique `(channel, externalId)` constraint
 *   return the SAME `id` with `inserted: false`. The ingest path does not emit
 *   on that branch; if it ever did, the key would still absorb the duplicate.
 * - `sequence` is unique only inside a conversation and is not the durable
 *   identity of the row the business just wrote — the PK is.
 *
 * Unstable alternatives (createdAt, Date.now()) are forbidden here for the same
 * reason they are forbidden for status changes: a retry would become a second
 * notification.
 */
export function messageInboundEventKey(event: NotificationEvent): string {
  const raw = event.payload?.messageId
  const messageId = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(messageId) || messageId <= 0) {
    throw new Error('message.inbound eventKey requires payload.messageId')
  }
  return eventKeyFor(event, `msg:${messageId}`)
}

/**
 * Assignment is repeatable — a lead can move from A to B to C — so identity
 * includes the assignee. Retrying the same transfer to the same user collapses
 * to one job (`to:{userId}`); a later transfer to a different user is news.
 *
 * The assignee is `clients.handlerId` after persist (the field `handler_or_admin`
 * resolves). `Date.now()` is forbidden here: a double-click would become two
 * notifications for one assignment.
 */
export function leadAssignedEventKey(event: NotificationEvent): string {
  const raw = event.payload?.assignedUserId
  const assignedUserId = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(assignedUserId) || assignedUserId <= 0) {
    throw new Error('lead.assigned eventKey requires payload.assignedUserId')
  }
  return eventKeyFor(event, `to:${assignedUserId}`)
}

/**
 * Disconnect is episodic — reconnect then fail again is news — so identity
 * includes the transition moment written with health_status=token_expired.
 * Polling while already expired must not invent a new moment (emit sites use
 * an atomic WHERE NOT token_expired guard).
 */
export function integrationDisconnectedEventKey(event: NotificationEvent): string {
  const raw = event.payload?.disconnectedAt
  const disconnectedAt = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(disconnectedAt) || disconnectedAt <= 0) {
    throw new Error('integration.disconnected eventKey requires payload.disconnectedAt')
  }
  return eventKeyFor(event, `at:${disconnectedAt}`)
}

/**
 * Ingestion failure is per failed inbound lead identity (Meta leadgen id /
 * WhatsApp message id). Retries of the same delivery collapse; a different
 * lead that also fails to persist is a distinct job (open-bell collapse still
 * merges per provider+agency).
 */
export function integrationIngestionFailedEventKey(event: NotificationEvent): string {
  const ref = event.payload?.externalLeadId?.trim()
  if (!ref) {
    throw new Error('integration.ingestion_failed eventKey requires payload.externalLeadId')
  }
  return eventKeyFor(event, `ext:${ref}`)
}

/**
 * Follow-up due/overdue is per scheduled instant: identity includes the
 * persisted `nextFollowUpAt` epoch ms. Cron re-entry collapses; reschedule to a
 * new timestamp is news. `Date.now()` is forbidden — the discriminator is the
 * row's own follow-up moment.
 */
export function followupAtEventKey(event: NotificationEvent): string {
  const raw = event.payload?.followUpAt
  const followUpAt = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(followUpAt) || followUpAt <= 0) {
    throw new Error(`${event.type} eventKey requires payload.followUpAt`)
  }
  return eventKeyFor(event, `at:${followUpAt}`)
}

/**
 * The identity rule per type — one place, so no call site has to know it.
 *
 * Everything except a status change, an inbound message, an assignment,
 * follow-up due/overdue, and the two integration failure types is once-ever
 * per entity. That is a deliberately QUIET default: a lead that turns hot,
 * cools, and turns hot again produces one `lead.hot` notification, not two.
 * Under care-charter Law 5 the second signal has to earn its interruption, and
 * "the analyzer changed its mind twice" does not. A type that genuinely needs
 * to recur adds its discriminator here rather than at its call site.
 */
export function eventKeyForEvent(event: NotificationEvent): string {
  if (event.type === 'lead.status_changed') return statusChangedEventKey(event)
  if (event.type === 'message.inbound') return messageInboundEventKey(event)
  if (event.type === 'lead.assigned') return leadAssignedEventKey(event)
  if (event.type === 'integration.disconnected') return integrationDisconnectedEventKey(event)
  if (event.type === 'integration.ingestion_failed') return integrationIngestionFailedEventKey(event)
  if (event.type === 'followup.due' || event.type === 'followup.overdue') return followupAtEventKey(event)
  return eventKeyFor(event)
}
