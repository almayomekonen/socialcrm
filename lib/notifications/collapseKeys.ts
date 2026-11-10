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
/**
 * One row per BATCH, per representative.
 *
 * Two components, and each earns its place. `entityId` is the representative, so
 * the key separates entities exactly as every other key does. The batch digest is
 * a pure function of which leads moved, so two different assignments to the same
 * rep are two pieces of work — while re-emitting the same batch (a retry) lands
 * on the same key and collapses instead of duplicating.
 *
 * Deliberately NOT keyed per lead: forty rows in the bell for one administrator
 * action is the dump care-charter Law 6 forbids. And deliberately not keyed on
 * time, which would break the purity rule the other keys hold to.
 */
export const assignmentBatchKey = (ctx: EventContext): string =>
  `assignment:${ctx.entityId}:${ctx.payload.assignmentBatchId ?? 'unbatched'}`

export const leadStatusKey = (ctx: EventContext): string => `lead:${ctx.entityId}:status`
export const leadActivityKey = (ctx: EventContext): string => `lead:${ctx.entityId}:activity`
export const conversationInboundKey = (ctx: EventContext): string => `conversation:${ctx.entityId}:inbound`
export const conversationUnansweredKey = (ctx: EventContext): string => `conversation:${ctx.entityId}:unanswered`
export const conversationHandoffKey = (ctx: EventContext): string => `conversation:${ctx.entityId}:handoff`
export const conversationPersonalKey = (ctx: EventContext): string => `conversation:${ctx.entityId}:personal`
export const followupKey = (ctx: EventContext): string => `lead:${ctx.entityId}:followup`
/**
 * Its own prefix: a Messenger conversation id can equal a WhatsApp conversation id.
 * Exported by conversation id too, because reading the conversation closes this row.
 */
export const messengerConversationInboundKey = (conversationId: number): string => `messenger:${conversationId}:inbound`
export const messengerInboundKey = (ctx: EventContext): string => messengerConversationInboundKey(ctx.entityId)

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
export const integrationKey = (ctx: EventContext): string => `integration:${ctx.payload.provider ?? 'unknown'}:${ctx.agencyId}`

/**
 * One open AI insight per ליד per rep.
 *
 * Deliberately DISTINCT from `followupKey` so an insight never overwrites a
 * deterministic follow-up notification's copy. The two can only ever coexist about
 * one ליד when they concern different facts, because DA-001 §9.1 condition 13
 * forbids the AI from surfacing anything a deterministic type already owns.
 *
 * This is the DELIVERY dedup, per user. The CONCLUSION's own dedup lives on
 * `ai_insights.insightKey` and is not released when a notification is read.
 */
export const insightKey = (ctx: EventContext): string => `lead:${ctx.entityId}:insight`

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
