import { formatBusinessTime, businessDateString } from '@/lib/today/time'
import { redactContactDetails } from '../render'
import { hebrewDateLabel } from '../meetings/when'
import { CALENDAR_LINK, REJECT_TITLE, type GoogleState } from '../meetings/copy'
import { TASKS_LINK } from '../tasks/copy'
import type { ReplyButton } from '@/lib/whatsapp/platform/sendText'
import type { MeetingTarget, TaskTarget } from './targets'

/**
 * Every WhatsApp sentence about changing an existing task or appointment. Pure.
 * Facts come only from the resolved row and the action's stored arguments.
 */

export type ChangeType = 'update_task' | 'complete_task' | 'reschedule_meeting' | 'cancel_meeting'

const name = (lead: string) => redactContactDetails(lead).trim() || 'ליד'
const clip = (s: string, n = 120) => {
  const t = redactContactDetails(s).trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}
const dueLine = (d: string | null) => (d ? hebrewDateLabel(d) : 'ללא תאריך')
export const meetingWhen = (start: Date, end: Date) => `${hebrewDateLabel(businessDateString(start.getTime()))}, ${formatBusinessTime(start)}–${formatBusinessTime(end)}`
const EXPIRY = 'האישור בתוקף ל-15 דקות.'

export const CHANGE_COPY = {
  leadNotAllowed: 'לא מצאתי את הליד הזה בין הלידים שלך, אז לא שיניתי דבר. אפשר לבדוק את השם ולנסות שוב.',
  noTask: 'לא מצאתי משימה פתוחה של הליד הזה, אז לא שיניתי דבר.',
  noMeeting: 'לא מצאתי פגישה קרובה שלך עם הליד הזה, אז לא שיניתי דבר.',
  askWhatToChange: 'מה לשנות במשימה?',
  askNewTime: 'לאיזה מועד להזיז את הפגישה?',
  sameTime: 'הפגישה כבר קבועה למועד הזה, אז לא שיניתי דבר.',
  notPrepared: 'לא הצלחתי להכין את הבקשה הפעם, ולא שיניתי דבר. אפשר לנסות שוב בעוד רגע.',
  rejected: 'בסדר, לא שיניתי דבר.',
  expired: 'האישור פג תוקף (15 דקות), ולא שיניתי דבר. אפשר לבקש שוב.',
  superseded: 'יש בקשה חדשה יותר. אפשר לאשר אותה בהודעה האחרונה.',
  alreadyDecided: 'הבקשה הזו כבר טופלה.',
  notFound: 'לא מצאתי בקשה פתוחה לאשר.',
  changed: 'הרשומה השתנתה מאז שהכנתי את הבקשה, ולכן לא שיניתי דבר. אפשר לבקש שוב.',
  unverified: 'לא הצלחתי לאמת שהשינוי נשמר. כדאי לבדוק ב-SocialCRM לפני שמבקשים שוב: ' + TASKS_LINK,
  notAuthorized: 'אין לך הרשאה לשנות את הרשומה הזו, ולכן לא שיניתי דבר.',
  failed: 'השינוי לא בוצע. אפשר לנסות שוב או ב-SocialCRM: ' + TASKS_LINK,
} as const

export function whichTask(tasks: readonly TaskTarget[]): string {
  return ['לאיזו משימה הכוונה?', ...tasks.map((t, i) => `${i + 1}. ${clip(t.title, 80)} (${dueLine(t.dueDate)})`)].join('\n')
}

export function whichMeeting(meetings: readonly MeetingTarget[]): string {
  return ['לאיזו פגישה הכוונה?', ...meetings.map((m, i) => `${i + 1}. ${meetingWhen(m.startAt, m.endAt)}`)].join('\n')
}

export function updateTaskCard(input: { lead: string; task: TaskTarget; title: string; dueDate: string | null }): string {
  const lines = ['*לעדכן את המשימה?*', `ליד: ${name(input.lead)}`, `משימה: ${clip(input.task.title)}`]
  if (input.title !== input.task.title) lines.push(`כותרת חדשה: ${clip(input.title)}`)
  if (input.dueDate !== input.task.dueDate) lines.push(`תאריך: ${dueLine(input.task.dueDate)} ← ${dueLine(input.dueDate)}`)
  lines.push(EXPIRY)
  return lines.join('\n')
}

export function completeTaskCard(input: { lead: string; task: TaskTarget }): string {
  return ['*לסמן את המשימה כבוצעה?*', `ליד: ${name(input.lead)}`, `משימה: ${clip(input.task.title)}`, `תאריך: ${dueLine(input.task.dueDate)}`, EXPIRY].join('\n')
}

const googleLine = (linked: boolean) => (linked ? 'יומן: SocialCRM וגם יומן Google שלך, בלי לשלוח עדכון למוזמנים' : 'יומן: SocialCRM בלבד')

export function rescheduleCard(input: { lead: string; meeting: MeetingTarget; start: Date; end: Date; googleLinked: boolean }): string {
  return [
    '*להזיז את הפגישה?*',
    `ליד: ${name(input.lead)}`,
    `במקום: ${meetingWhen(input.meeting.startAt, input.meeting.endAt)}`,
    `למועד: ${meetingWhen(input.start, input.end)}`,
    googleLine(input.googleLinked),
    'לא תישלח הודעה לליד.',
    'בדקתי חפיפה מול הפגישות שלך ב-SocialCRM בלבד, לא מול יומן Google.',
    EXPIRY,
  ].join('\n')
}

export function cancelCard(input: { lead: string; meeting: MeetingTarget; googleLinked: boolean }): string {
  return [
    '*לבטל את הפגישה?*',
    `ליד: ${name(input.lead)}`,
    `מועד: ${meetingWhen(input.meeting.startAt, input.meeting.endAt)}`,
    googleLine(input.googleLinked),
    'לא תישלח הודעה לליד. אם צריך לעדכן אותו, יש לעשות זאת בנפרד.',
    EXPIRY,
  ].join('\n')
}

const APPROVE: Record<ChangeType, string> = {
  update_task: 'לאשר ולעדכן',
  complete_task: 'לאשר ולסמן',
  reschedule_meeting: 'לאשר ולהזיז',
  cancel_meeting: 'לאשר ולבטל',
}

/** On a cancellation "ביטול" would read as confirming it, so that card's second button says what it keeps. */
export function changeButtons(token: string, type: ChangeType): ReplyButton[] {
  return [
    { id: `wa:approve:${token}`, title: APPROVE[type] },
    { id: `wa:reject:${token}`, title: type === 'cancel_meeting' ? 'להשאיר את הפגישה' : REJECT_TITLE },
  ]
}

const googleNote = (g: GoogleState) =>
  g === 'synced' ? 'עודכן גם ביומן Google.' : g === 'not_connected' ? null : `לא הצלחתי לעדכן את יומן Google. כדאי לבדוק: ${CALENDAR_LINK}`

export function taskChangedReply(input: { type: 'update_task' | 'complete_task'; already: boolean; lead: string; title: string; dueDate?: string | null }): string {
  const head = input.type === 'complete_task' ? (input.already ? '*המשימה כבר מסומנת כבוצעה*' : '*המשימה סומנה כבוצעה*') : input.already ? '*המשימה כבר מעודכנת*' : '*המשימה עודכנה*'
  const lines = [head, `ליד: ${name(input.lead)}`, `משימה: ${clip(input.title)}`]
  if (input.type === 'update_task') lines.push(`תאריך: ${dueLine(input.dueDate ?? null)}`)
  lines.push(`לפרטים: ${TASKS_LINK}`)
  return lines.join('\n')
}

export function meetingChangedReply(input: { type: 'reschedule_meeting' | 'cancel_meeting'; already: boolean; lead: string; start: Date; end: Date; google: GoogleState }): string {
  const head = input.type === 'cancel_meeting' ? (input.already ? '*הפגישה כבר בוטלה*' : '*הפגישה בוטלה ב-SocialCRM*') : input.already ? '*הפגישה כבר במועד הזה*' : '*הפגישה הוזזה ב-SocialCRM*'
  return [head, `ליד: ${name(input.lead)}`, `מועד: ${meetingWhen(input.start, input.end)}`, googleNote(input.google), `לפרטים: ${CALENDAR_LINK}`].filter(Boolean).join('\n')
}
