import { redactContactDetails } from '../render'
import { hebrewDateLabel } from '../meetings/when'
import { REJECT_TITLE } from '../meetings/copy'
import type { ReplyButton } from '@/lib/whatsapp/platform/sendText'

/**
 * Every WhatsApp sentence about a task or a follow-up. Pure. Facts come only
 * from the caller's persisted data (the action's stored arguments, the lead
 * row); nothing here says "done" unless the caller holds a verified outcome.
 */

export const TASKS_LINK = 'https://getsocialcrm.com/tasks'
export const APPROVE_TASK_TITLE = 'לאשר וליצור'
export const APPROVE_FOLLOW_UP_TITLE = 'לאשר ולקבוע'

const name = (lead: string) => redactContactDetails(lead).trim() || 'ליד'
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

export const TASK_COPY = {
  // Clarifications about WHEN live in ../whenCopy.ts. ONE short question, never
  // a repeat of what the owner already said, never a word about how it works.
  askLead: 'לאיזה ליד?',
  askTitle: 'מה לכתוב במשימה?',
  useButtons: 'כדי לאשר או לבטל, לחצו על הכפתור בהודעה האחרונה עם פרטי הבקשה.',
  leadNotAllowed: 'לא מצאתי את הליד הזה בין הלידים שלך, אז לא יצרתי דבר. אפשר לבדוק את השם ולנסות שוב.',
  notPrepared: 'לא הצלחתי להכין את הבקשה הפעם, ולא נוצר דבר. אפשר לנסות שוב בעוד רגע או ב-SocialCRM: ' + TASKS_LINK,
  rejected: 'בוטל. לא נוצר דבר.',
  expired: 'האישור פג תוקף (15 דקות), ולא נוצר דבר. אפשר לבקש שוב.',
  superseded: 'יש בקשה חדשה יותר. אפשר לאשר אותה בהודעה האחרונה.',
  alreadyDecided: 'הבקשה הזו כבר טופלה.',
  notFound: 'לא מצאתי בקשה פתוחה לאשר.',
  changed: 'פרטי הבקשה השתנו, ולכן היא לא בוצעה. אפשר לבקש שוב.',
  unverified: 'לא הצלחתי לאמת שהבקשה נשמרה. כדאי לבדוק ב-SocialCRM לפני שמבקשים שוב: ' + TASKS_LINK,
  notAuthorized: 'אין לך הרשאה לליד הזה, ולכן לא נוצר דבר.',
  failed: 'הבקשה לא בוצעה. אפשר לנסות שוב או ב-SocialCRM: ' + TASKS_LINK,
} as const

/** "יום רביעי, 04.11.2026, בשעה 12:00" — the day, and the time of day when one was given. */
const dateLine = (date: string, when: string | null) => `לתאריך: ${hebrewDateLabel(date)}${when ? `, ${when}` : ''}`

export function taskCard(input: { lead: string; title: string; dueDate: string; when?: string | null }): string {
  return [
    '*ליצור משימה?*',
    `ליד: ${name(input.lead)}`,
    `משימה: ${clip(redactContactDetails(input.title), 200)}`,
    dateLine(input.dueDate, input.when ?? null),
    'האישור בתוקף ל-15 דקות.',
  ].join('\n')
}

export function followUpCard(input: { lead: string; at: string; note: string | null; when?: string | null }): string {
  const lines = ['*לקבוע מעקב?*', `ליד: ${name(input.lead)}`, dateLine(input.at, input.when ?? null)]
  if (input.note) lines.push(`הערה: ${clip(redactContactDetails(input.note), 200)}`)
  lines.push('אם כבר יש מעקב לליד הזה, הוא יוחלף בתאריך החדש.', 'האישור בתוקף ל-15 דקות.')
  return lines.join('\n')
}

export function taskButtons(token: string, kind: 'task' | 'follow_up'): ReplyButton[] {
  return [
    { id: `wa:approve:${token}`, title: kind === 'task' ? APPROVE_TASK_TITLE : APPROVE_FOLLOW_UP_TITLE },
    { id: `wa:reject:${token}`, title: REJECT_TITLE },
  ]
}

/** Built ONLY from a verified outcome and the re-read lead. */
export function taskSuccessReply(input: { kind: 'task' | 'follow_up'; already: boolean; lead: string; date: string }): string {
  const head =
    input.kind === 'task'
      ? input.already
        ? '*המשימה הזו כבר קיימת ב-SocialCRM*'
        : '*המשימה נוצרה ב-SocialCRM*'
      : input.already
        ? '*המעקב הזה כבר קבוע ב-SocialCRM*'
        : '*המעקב נקבע ב-SocialCRM*'
  return [head, `ליד: ${name(input.lead)}`, `לתאריך: ${hebrewDateLabel(input.date)}`, `לפרטים: ${TASKS_LINK}`].join('\n')
}
