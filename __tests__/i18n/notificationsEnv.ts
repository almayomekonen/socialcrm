/**
 * Fixtures for the notification tests (i18n Phase F3): the session user, the
 * rollout flags, the device answer, the stored interface-language preference
 * and the rows the feed returns. Every row's `title` / `body` is produced by
 * the EMITTER'S OWN copy function (`NOTIFICATION_REGISTRY[type].title(ctx)`),
 * so the fixtures are exactly what production stores. A few rows carry text
 * no current emitter writes (an older word order, free text) — those are the
 * legacy rows a read-time mapping must leave verbatim.
 */
import { NOTIFICATION_REGISTRY } from '@/lib/notifications/registry'
import type { EventContext, NotificationPayload, NotificationType } from '@/lib/notifications/types'
import type { NotificationFeedItem } from '@/modules/notifications/types'

export const NOW = Date.parse('2026-10-30T09:00:00Z')
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString()

export { NOTIF_USER, NOTIF_CUSTOMER_DATA, notifEnv, resetNotifEnv } from './notificationsState'

export function ctxFor(type: NotificationType, payload: NotificationPayload = {}, groupCount = 1): EventContext {
  return { type, agencyId: 103, entityType: 'lead', entityId: 55, actorUserId: null, occurredAt: new Date(NOW), payload, groupCount }
}

let nextId = 100

/** A feed row built from the emitter's own copy for `type` + `payload`. */
export function emitted(
  type: NotificationType,
  payload: NotificationPayload = {},
  over: Partial<NotificationFeedItem> & { groupCount?: number } = {},
): NotificationFeedItem {
  const def = NOTIFICATION_REGISTRY[type]
  const ctx = ctxFor(type, payload, over.groupCount ?? 1)
  return {
    id: over.id ?? nextId++,
    type,
    category: def.category,
    priority: def.basePriority,
    title: def.title(ctx),
    body: def.body(ctx),
    entityType: def.entity(ctx).type,
    entityId: 55,
    deepLink: def.deepLink(ctx),
    groupCount: ctx.groupCount,
    createdAt: ago(5),
    seenAt: null,
    readAt: null,
    toastEligible: false,
    ...over,
  }
}

/**
 * Every emitter shape the registry can write: with and without a name, each
 * count form, each provider label (known and unknown), both questionnaire
 * outcomes, the operator cancellation with and without an agency name.
 */
export function everyEmittedShape(): NotificationFeedItem[] {
  nextId = 100
  const n = { leadName: 'יוסי לוי' }
  return [
    emitted('lead.created', n, { createdAt: ago(0) }),
    emitted('lead.created', {}, { createdAt: ago(3) }),
    emitted('lead.hot', { leadName: 'מיכל אברהם' }, { createdAt: ago(12) }),
    emitted('lead.questionnaire_handoff', { ...n, complete: true }, { createdAt: ago(40) }),
    emitted('lead.questionnaire_handoff', { ...n, complete: false }, { createdAt: ago(55) }),
    emitted('lead.assigned', n, { createdAt: ago(70), readAt: ago(60), seenAt: ago(65) }),
    emitted('lead.bulk_assigned', { assignedCount: 0 }, { createdAt: ago(90) }),
    emitted('lead.bulk_assigned', { assignedCount: 1 }, { createdAt: ago(100) }),
    emitted('lead.bulk_assigned', { assignedCount: 12 }, { createdAt: ago(110) }),
    emitted('lead.status_changed', n, { createdAt: ago(130), readAt: ago(120) }),
    emitted('lead.activity', n, { createdAt: ago(150) }),
    emitted('lead.insight', n, { createdAt: ago(170) }),
    emitted('lead.handoff', { leadName: 'רונית' }, { createdAt: ago(190) }),
    emitted('message.inbound', n, { createdAt: ago(200) }),
    emitted('message.inbound_multiple', n, { createdAt: ago(210), groupCount: 4 }),
    emitted('message.unanswered', n, { createdAt: ago(230) }),
    emitted('message.messenger_inbound', { leadName: 'Almayo Mekonen' }, { createdAt: ago(250) }),
    emitted('message.messenger_inbound', {}, { createdAt: ago(260), groupCount: 3 }),
    emitted('comment.received', { leadName: 'רונית' }, { createdAt: ago(300) }),
    emitted('followup.due', n, { createdAt: ago(60 * 5) }),
    emitted('followup.overdue', n, { createdAt: ago(60 * 26), readAt: ago(60 * 20) }),
    emitted('integration.disconnected', { provider: 'facebook' }, { createdAt: ago(60 * 30) }),
    emitted('integration.disconnected', { provider: 'whatsapp' }, { createdAt: ago(60 * 50) }),
    emitted('integration.error', { provider: 'whatsapp' }, { createdAt: ago(60 * 52) }),
    emitted('integration.error', {}, { createdAt: ago(60 * 53) }),
    emitted('integration.ingestion_failed', { provider: 'facebook' }, { createdAt: ago(60 * 54) }),
    emitted('integration.ingestion_failed', { provider: 'tiktok' }, { createdAt: ago(60 * 55) }),
    emitted('subscription.cancellation_requested', { cancellingAgencyName: 'סטודיו נגה' }, { createdAt: ago(60 * 72) }),
    emitted('subscription.cancellation_requested', {}, { createdAt: ago(60 * 80) }),
  ]
}

/** Rows no current emitter writes: an older title format, and free text in a body. */
export function legacyRows(): NotificationFeedItem[] {
  return [
    emitted('lead.created', {}, { id: 900, title: 'ליד חדש: יוסי לוי', createdAt: ago(60 * 24 * 3) }),
    emitted('message.messenger_inbound', {}, { id: 901, title: 'הודעה חדשה ב-Messenger — רונית', createdAt: ago(60 * 24 * 4) }),
    emitted('lead.hot', {}, { id: 902, title: 'ליד חם', body: 'שלוש פניות בשבוע', createdAt: ago(60 * 24 * 5) }),
  ]
}

/** One page of the center (25 rows) so the server returns a next cursor. */
export function fullPage(): NotificationFeedItem[] {
  const shapes = everyEmittedShape()
  return Array.from({ length: 25 }, (_, i) => ({ ...shapes[i % shapes.length], id: 500 + i }))
}
