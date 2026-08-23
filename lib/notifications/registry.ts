/**
 * THE NOTIFICATION REGISTRY — the single source of truth. Spec §5.
 *
 * NOTE ON SIZE (architecture-rules.md §6): this file is over the 250-line soft
 * limit, and intentionally so. It is sixteen uniform data entries with one
 * concern and no branching — every behavior it references lives in copy.ts,
 * collapseKeys.ts and policy.ts, which is where new logic goes. The spec
 * requires the registry to be THE single source of truth (§5); splitting it by
 * category would mean five files to consult to answer "what types exist" and
 * would let two halves drift. Adding a type adds ~14 declarative lines here; if
 * this file ever grows logic rather than entries, that logic is the thing to
 * extract, not the table.
 *
 * Adding a notification type means adding ONE entry here. It never means
 * editing the engine: the worker reads `recipients`, `collapseKey`, `title`,
 * `body`, `entity`, `deepLink` and `channels` off the entry and has no
 * knowledge of any specific type.
 *
 * Completeness is enforced by the COMPILER, not by a test: the record is typed
 * `Record<NotificationType, NotificationTypeDef>`, so a new member of the union
 * without an entry here fails `tsc`. The unit tests cover the four invariants a
 * type system cannot express (spec §5).
 *
 * P1 SCOPE NOTE — no entry declares `escalation` or `isResolved`. That is not an
 * omission, it is the fail-closed gate (spec §9.2 rules 4 and 6) at rest: a type
 * may only escalate if it can PROVE it is still unhandled, and the predicates
 * plus the ladder arrive together in P4. Until then every type stops at level 0,
 * which is the correct behavior for a system that cannot yet check resolution.
 *
 * Two types are `enabled: false` (sla.*). They are a registry extension point
 * with no semantics, no emitter and no predicate — see spec §4.5 and copy.ts.
 */

import * as copy from './copy'
import * as keys from './collapseKeys'
import {
  CRITICAL_WITH_EMAIL,
  IN_APP_ONLY,
  PUSH_WHEN_AWAY,
  TOAST_THEN_PUSH_WHEN_AWAY,
  TOAST_THEN_PUSH_WHEN_OFFLINE,
} from './policy'
import type { EventContext, NotificationType, NotificationTypeDef } from './types'

const leadEntity = (ctx: EventContext) => ({ type: 'lead' as const, id: ctx.entityId })
const conversationEntity = (ctx: EventContext) => ({ type: 'conversation' as const, id: ctx.entityId })
const integrationEntity = (ctx: EventContext) => ({ type: 'integration' as const, id: ctx.entityId })
const commentEntity = (ctx: EventContext) => ({ type: 'comment' as const, id: ctx.entityId })
/** The CANCELLING agency — never ctx.agencyId, which here is the platform owner's. */
const subscriptionEntity = (ctx: EventContext) => ({ type: 'subscription' as const, id: ctx.entityId })

/**
 * Deep links target the ENTITY, never a notification (spec §20.2). There is no
 * /notifications/{id} route and no notification id in any URL, so a
 * notification can never act as a capability. The target route runs its own
 * authorization at click time (spec §20.3).
 *
 * A lead's routable URL includes /summary. `/clients/{id}` has a layout but no
 * page, so it 404s — every other lead link in the app carries the suffix too.
 */
const leadLink = (ctx: EventContext) => `/clients/${ctx.entityId}/summary`
const conversationLink = (ctx: EventContext) => `/inbox?conversation=${ctx.entityId}`
const integrationLink = () => '/settings/integrations'
/** Comments Inbox list — no per-comment route exists yet. */
const commentsInboxLink = () => '/inbox/comments'
/** The platform-owner surface. Gated by isPlatformOwner, the same allowlist the
 *  `platform_operator` recipient rule resolves by, so the link can only be
 *  followed by someone entitled to receive the notification in the first place. */
const adminLink = () => '/admin'

export const NOTIFICATION_REGISTRY: Record<NotificationType, NotificationTypeDef> = {
  'lead.created': {
    type: 'lead.created',
    category: 'leads',
    enabled: true,
    basePriority: 'medium',
    collapseKey: keys.arrivalKey,
    title: copy.leadCreatedTitle,
    body: copy.noBody,
    entity: leadEntity,
    deepLink: leadLink,
    recipients: 'handler_or_admin',
    channels: TOAST_THEN_PUSH_WHEN_OFFLINE,
  },

  'lead.hot': {
    type: 'lead.hot',
    category: 'leads',
    enabled: true,
    basePriority: 'high',
    // Shares the arrival key: a lead turning out to be hot upgrades the arrival
    // row in place rather than adding a second thing to work (spec §10.2).
    collapseKey: keys.arrivalKey,
    title: copy.leadHotTitle,
    body: copy.noBody,
    entity: leadEntity,
    deepLink: leadLink,
    recipients: 'handler_or_admin',
    channels: TOAST_THEN_PUSH_WHEN_AWAY,
  },

  'lead.assigned': {
    type: 'lead.assigned',
    category: 'leads',
    enabled: true,
    basePriority: 'medium',
    collapseKey: keys.arrivalKey,
    title: copy.leadAssignedTitle,
    body: copy.noBody,
    entity: leadEntity,
    deepLink: leadLink,
    recipients: 'handler_or_admin',
    channels: TOAST_THEN_PUSH_WHEN_OFFLINE,
  },

  'lead.status_changed': {
    type: 'lead.status_changed',
    category: 'leads',
    enabled: true,
    basePriority: 'low',
    collapseKey: keys.leadStatusKey,
    title: copy.leadStatusChangedTitle,
    body: copy.noBody,
    entity: leadEntity,
    deepLink: leadLink,
    recipients: 'handler_or_admin',
    channels: IN_APP_ONLY,
  },

  'lead.activity': {
    type: 'lead.activity',
    category: 'leads',
    enabled: true,
    basePriority: 'info',
    collapseKey: keys.leadActivityKey,
    title: copy.leadActivityTitle,
    body: copy.noBody,
    entity: leadEntity,
    deepLink: leadLink,
    recipients: 'handler_or_admin',
    channels: IN_APP_ONLY,
  },

  'message.inbound': {
    type: 'message.inbound',
    category: 'messages',
    enabled: true,
    basePriority: 'high',
    collapseKey: keys.conversationInboundKey,
    title: copy.messageInboundTitle,
    body: copy.noBody,
    entity: conversationEntity,
    deepLink: conversationLink,
    recipients: 'handler_or_admin',
    channels: TOAST_THEN_PUSH_WHEN_AWAY,
  },

  /**
   * AGGREGATION ONLY (spec §4.6). Declares no predicate and no ladder, so the
   * fail-closed gate means it never escalates — resolution and escalation stay
   * with message.inbound / message.unanswered, which own the real business
   * state. It exists so the bell can show one truthful "several messages
   * arrived" row without duplicating escalation responsibility.
   */
  'message.inbound_multiple': {
    type: 'message.inbound_multiple',
    category: 'messages',
    enabled: true,
    basePriority: 'medium',
    collapseKey: keys.conversationInboundKey,
    title: copy.messageInboundMultipleTitle,
    body: copy.noBody,
    entity: conversationEntity,
    deepLink: conversationLink,
    recipients: 'handler_or_admin',
    channels: TOAST_THEN_PUSH_WHEN_OFFLINE,
  },

  'message.unanswered': {
    type: 'message.unanswered',
    category: 'messages',
    enabled: true,
    basePriority: 'high',
    collapseKey: keys.conversationUnansweredKey,
    title: copy.messageUnansweredTitle,
    body: copy.noBody,
    entity: conversationEntity,
    deepLink: conversationLink,
    recipients: 'handler_or_admin',
    // V1: in-app only — no toast (Awareness owns live inbound), no push.
    channels: IN_APP_ONLY,
  },

  /**
   * Facebook Page comment — domain event from ingestFacebookComment. NOT
   * message.inbound: comments have no conversation/lead until converted.
   * admin_only + IN_APP_ONLY for v1 canary safety (open comments have no handler).
   */
  'comment.received': {
    type: 'comment.received',
    category: 'messages',
    enabled: true,
    basePriority: 'medium',
    collapseKey: keys.commentPostKey,
    title: copy.commentReceivedTitle,
    body: copy.noBody,
    entity: commentEntity,
    deepLink: commentsInboxLink,
    recipients: 'admin_only',
    channels: IN_APP_ONLY,
  },

  'followup.due': {
    type: 'followup.due',
    category: 'followups',
    enabled: true,
    basePriority: 'medium',
    collapseKey: keys.followupKey,
    title: copy.followupDueTitle,
    body: copy.noBody,
    entity: leadEntity,
    deepLink: leadLink,
    recipients: 'handler_or_admin',
    channels: TOAST_THEN_PUSH_WHEN_OFFLINE,
  },

  'followup.overdue': {
    type: 'followup.overdue',
    category: 'followups',
    enabled: true,
    basePriority: 'high',
    collapseKey: keys.followupKey,
    title: copy.followupOverdueTitle,
    body: copy.noBody,
    entity: leadEntity,
    deepLink: leadLink,
    recipients: 'handler_or_admin',
    channels: PUSH_WHEN_AWAY,
  },

  // A נציג cannot fix a broken Facebook token, so integration health is
  // admin_only — telling a rep about it would be noise they cannot act on
  // (spec §6.1, care-charter Law 7).
  'integration.disconnected': {
    type: 'integration.disconnected',
    category: 'integrations',
    enabled: true,
    basePriority: 'critical',
    collapseKey: keys.integrationKey,
    title: copy.integrationDisconnectedTitle,
    body: copy.integrationDisconnectedBody,
    entity: integrationEntity,
    deepLink: integrationLink,
    recipients: 'admin_only',
    channels: CRITICAL_WITH_EMAIL,
  },

  'integration.error': {
    type: 'integration.error',
    category: 'integrations',
    enabled: true,
    basePriority: 'high',
    collapseKey: keys.integrationKey,
    title: copy.integrationErrorTitle,
    body: copy.noBody,
    entity: integrationEntity,
    deepLink: integrationLink,
    recipients: 'admin_only',
    channels: PUSH_WHEN_AWAY,
  },

  'integration.ingestion_failed': {
    type: 'integration.ingestion_failed',
    category: 'integrations',
    enabled: true,
    basePriority: 'critical',
    collapseKey: keys.integrationKey,
    title: copy.integrationIngestionFailedTitle,
    body: copy.integrationIngestionFailedBody,
    entity: integrationEntity,
    deepLink: integrationLink,
    recipients: 'admin_only',
    channels: CRITICAL_WITH_EMAIL,
  },

  // ── Registered, DISABLED, no semantics (spec §4.5) ────────────────────────
  // No emitter exists for either. No isResolved, no ladder. They exist so a
  // future, separately-defined SLA system plugs in without an engine change.
  'sla.approaching': {
    type: 'sla.approaching',
    category: 'sla',
    enabled: false,
    basePriority: 'high',
    collapseKey: keys.slaKey,
    title: copy.slaPlaceholderTitle,
    body: copy.noBody,
    entity: leadEntity,
    deepLink: leadLink,
    recipients: 'handler_or_admin',
    channels: PUSH_WHEN_AWAY,
  },

  'sla.breached': {
    type: 'sla.breached',
    category: 'sla',
    enabled: false,
    basePriority: 'critical',
    collapseKey: keys.slaKey,
    title: copy.slaPlaceholderTitle,
    body: copy.noBody,
    entity: leadEntity,
    deepLink: leadLink,
    recipients: 'handler_or_admin',
    channels: CRITICAL_WITH_EMAIL,
  },

  /**
   * The one PLATFORM-level entry. A customer cancelled in SocialCRM, and their
   * standing order at Grow still has to be stopped by hand — there is no
   * documented cancellation API and no outbound Grow client, so nothing in this
   * system can do it. The notification exists to make that manual step
   * impossible to forget; it never claims the standing order was cancelled.
   *
   * `category: 'integrations'` is REUSED, not invented: `notifications.category`
   * carries a database CHECK over exactly five values, so a new category would
   * require a migration, and an external payment mandate needing attention is
   * genuinely the integrations bucket. `entity`/`deepLink` point at the cancelling
   * agency and /admin — the platform-owner surface that already lists agencies
   * and is gated by the same `isPlatformOwner` allowlist this type resolves by.
   *
   * `PUSH_WHEN_AWAY` rather than `CRITICAL_WITH_EMAIL`: email is capability-false
   * in `buildWorkerCapabilities` and has no dispatcher in processJob, so
   * declaring it would promise a channel that silently never fires. In-app
   * always, push once attention lapses — both proven paths.
   */
  'subscription.cancellation_requested': {
    type: 'subscription.cancellation_requested',
    category: 'integrations',
    enabled: true,
    basePriority: 'high',
    collapseKey: keys.subscriptionCancelKey,
    title: copy.subscriptionCancellationTitle,
    body: copy.subscriptionCancellationBody,
    entity: subscriptionEntity,
    deepLink: adminLink,
    recipients: 'platform_operator',
    channels: PUSH_WHEN_AWAY,
  },
}

/** Unknown string ⇒ undefined. The worker skips such a job rather than guessing. */
export function getNotificationType(type: string): NotificationTypeDef | undefined {
  return NOTIFICATION_REGISTRY[type as NotificationType]
}

export function isEmittableType(type: string): boolean {
  return getNotificationType(type)?.enabled === true
}
