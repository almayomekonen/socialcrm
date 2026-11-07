import { TOAST_THEN_PUSH_WHEN_OFFLINE } from './policy'
import type { EventContext, NotificationTypeDef } from './types'

/**
 * Reminder Engine R9: the owner is told, in the app, when their own personal
 * WhatsApp reminder could not be delivered. Two types, because the two facts
 * differ and must never be worded alike:
 *
 *   followup.reminder_failed       DEFINITELY not delivered (Meta rejected it, Meta
 *                                  later reported it failed, or the send gate refused it)
 *   followup.reminder_unconfirmed  the outcome is UNKNOWN: it may have reached Meta,
 *                                  and SocialCRM never resends it automatically
 *
 * Kept beside registry.ts (already over the size limit) and spread into it.
 *
 *   - RECIPIENT: `reminder_owner`, resolved from the database by (agency, reminder)
 *     and limited to an unsuspended user of that agency. Never a lead, never a
 *     customer, never another user.
 *   - CONTENT: the reminder's scheduled time only, NEVER its text. Reminder text is
 *     purged 90 days after a terminal state; an unread notification is kept until
 *     read, so it must not carry the text. No provider code or operational detail.
 *   - CATEGORY `followups`: the owner's own follow-up preference governs it.
 *   - ONCE per reminder per type: the default event key (type, agency, entity) is
 *     globally unique and the enqueue is ON CONFLICT DO NOTHING.
 *
 * Hebrew strings here are the catalog sentences of
 * lib/i18n/messages/he/notifications/content.ts, byte for byte (pinned by
 * __tests__/i18n/notificationsDisplayPin.test.ts).
 */

const reminderEntity = (ctx: EventContext) => ({ type: 'personal_reminder' as const, id: ctx.entityId })
/** Where the owner manages personal reminders (no per-reminder page exists). */
const reminderLink = (ctx: EventContext) => `/settings/whatsapp_reminders?reminder=${ctx.entityId}`
const reminderKey = (ctx: EventContext): string => `personal_reminder:${ctx.entityId}:outcome`

/** "07.11.2026 14:35" in the business timezone: language-neutral, so en/ar can carry it exactly as stored. */
export function reminderWhen(ms: number | null | undefined): string | null {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return null
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hourCycle: 'h23', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      .formatToParts(new Date(ms))
      .map((x) => [x.type, x.value]),
  ) as Record<string, string>
  return `${p.day}.${p.month}.${p.year} ${p.hour}:${p.minute}`
}

export const reminderFailedTitle = (): string => 'תזכורת לא נשלחה'
export const reminderFailedBody = (ctx: EventContext): string => {
  const when = reminderWhen(ctx.payload.remindAtMs)
  return when ? `לא הצלחנו לשלוח לך בוואטסאפ את התזכורת שביקשת ל-${when}.` : 'לא הצלחנו לשלוח לך בוואטסאפ את התזכורת שביקשת.'
}
export const reminderUnconfirmedTitle = (): string => 'לא ניתן לוודא שתזכורת נשלחה'
export const reminderUnconfirmedBody = (ctx: EventContext): string => {
  const when = reminderWhen(ctx.payload.remindAtMs)
  return when
    ? `לא הצלחנו לוודא שהתזכורת שביקשת ל-${when} הגיעה אליך בוואטסאפ. ייתכן שהיא הגיעה, ולכן היא לא תישלח שוב אוטומטית.`
    : 'לא הצלחנו לוודא שהתזכורת שביקשת הגיעה אליך בוואטסאפ. ייתכן שהיא הגיעה, ולכן היא לא תישלח שוב אוטומטית.'
}

export const REMINDER_NOTIFICATION_DEFS = {
  'followup.reminder_failed': {
    type: 'followup.reminder_failed',
    category: 'followups',
    enabled: true,
    basePriority: 'high',
    collapseKey: reminderKey,
    title: reminderFailedTitle,
    body: reminderFailedBody,
    entity: reminderEntity,
    deepLink: reminderLink,
    recipients: 'reminder_owner',
    channels: TOAST_THEN_PUSH_WHEN_OFFLINE,
  },
  'followup.reminder_unconfirmed': {
    type: 'followup.reminder_unconfirmed',
    category: 'followups',
    enabled: true,
    basePriority: 'high',
    collapseKey: reminderKey,
    title: reminderUnconfirmedTitle,
    body: reminderUnconfirmedBody,
    entity: reminderEntity,
    deepLink: reminderLink,
    recipients: 'reminder_owner',
    channels: TOAST_THEN_PUSH_WHEN_OFFLINE,
  },
} satisfies Record<'followup.reminder_failed' | 'followup.reminder_unconfirmed', NotificationTypeDef>
