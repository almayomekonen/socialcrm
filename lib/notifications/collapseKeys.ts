/**
 * Collapse keys — the dedup identity. Spec §10.3.
 *
 * A collapse key answers "is this the same piece of work?". Pure functions of
 * business facts: never random, never time-seeded, never containing a job or
 * notification id. Two events that mean the same work MUST produce the same
 * string, or the bell grows a second row for one thing.
 *
 * The database enforces one OPEN (readAt IS NULL) row per (userId, collapseKey)
 * via a partial unique index, so these strings are what make the constraint
 * meaningful — and race-proof regardless of concurrent webhooks (spec §10.1).
 *
 * `lead:{id}:arrival` is shared by lead.created, lead.assigned and lead.hot on
 * purpose: a lead arriving, being assigned, and turning out to be hot is ONE
 * arrival the נציג works once. Collapsing them upgrades the row in place rather
 * than stacking three (spec §10.2).
 */

import type { EventContext } from './types'

export const arrivalKey = (ctx: EventContext): string => `lead:${ctx.entityId}:arrival`
export const leadStatusKey = (ctx: EventContext): string => `lead:${ctx.entityId}:status`
export const leadActivityKey = (ctx: EventContext): string => `lead:${ctx.entityId}:activity`
export const conversationInboundKey = (ctx: EventContext): string => `conversation:${ctx.entityId}:inbound`
export const conversationUnansweredKey = (ctx: EventContext): string => `conversation:${ctx.entityId}:unanswered`
export const followupKey = (ctx: EventContext): string => `lead:${ctx.entityId}:followup`

/**
 * Facebook comments collapse per post: several comments on one post are one
 * open unit of work in the Comments Inbox. pageId + postId come from the emit
 * site (persisted facebook_page_comments columns). postId is NOT NULL in the
 * schema; if either id is somehow missing, fall back to the comment PK so
 * unrelated comments never silently share a key.
 */
export const commentPostKey = (ctx: EventContext): string => {
  const pageId = ctx.payload.pageId?.trim()
  const postId = ctx.payload.postId?.trim()
  if (pageId && postId) return `comment:${pageId}:post:${postId}`
  return `comment:${pageId ?? 'unknown'}:id:${ctx.entityId}`
}

/**
 * Integration health is per provider per agency, not per event: a Facebook
 * token that breaks, retries, and breaks again is one broken connection until
 * someone fixes it. The agencyId is included because the entityId for an
 * integration is a provider-scoped id, not a globally unique row id.
 */
export const integrationKey = (ctx: EventContext): string =>
  `integration:${ctx.payload.provider ?? 'unknown'}:${ctx.agencyId}`

/** Registered-but-disabled sla.* types (spec §4.5). Never emitted. */
export const slaKey = (ctx: EventContext): string => `lead:${ctx.entityId}:sla`

/**
 * One open action per CANCELLING agency.
 *
 * Keyed on `entityId` — the cancelling agency — and deliberately NOT on
 * `ctx.agencyId`, which for this type is the platform owner's own agency and is
 * therefore identical across every cancellation. Keying on that would collapse
 * two different customers' cancellations into one row and lose one of them,
 * while each still needs its own manual action at the provider.
 *
 * Repeat cancellations by the SAME agency while the row is unread collapse into
 * it (still one pending action). Once read, the partial unique index releases
 * the key, so a later cancellation by that agency is correctly a new row.
 */
export const subscriptionCancelKey = (ctx: EventContext): string => `subscription-cancel:${ctx.entityId}`
