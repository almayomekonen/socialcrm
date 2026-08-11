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
 * The identity rule per type — one place, so no call site has to know it.
 *
 * Everything except a status change is once-ever per entity. That is a
 * deliberately QUIET default: a lead that turns hot, cools, and turns hot again
 * produces one `lead.hot` notification, not two. Under care-charter Law 5 the
 * second signal has to earn its interruption, and "the analyzer changed its mind
 * twice" does not. A type that genuinely needs to recur adds its discriminator
 * here rather than at its call site.
 */
export function eventKeyForEvent(event: NotificationEvent): string {
  if (event.type === 'lead.status_changed') return statusChangedEventKey(event)
  return eventKeyFor(event)
}
