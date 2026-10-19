import { formatBusinessTime } from '@/lib/today/time'
import { redactContactDetails } from '../render'
import { hebrewDateLabel } from './when'
import type { ReplyButton } from '@/lib/whatsapp/platform/sendText'

/**
 * Every WhatsApp sentence about a meeting. Pure. Facts come only from the
 * caller's persisted data (the action's stored arguments, the meeting row, the
 * calendar connection); nothing here says "done" unless the caller holds a
 * verified row. Availability is always attributed to SocialCRM, never to Google.
 */

export const CALENDAR_LINK = 'https://getsocialcrm.com/calendar'
export const APPROVE_TITLE = 'לאשר ולקבוע'
export const REJECT_TITLE = 'ביטול'
export const DECISION_ID_RE = /^wa:(approve|reject):([0-9a-f]{32})$/

export type GoogleState = 'not_connected' | 'synced' | 'failed' | 'reauth_required' | 'unconfirmed'

const span = (start: Date, end: Date) => `${formatBusinessTime(start)}–${formatBusinessTime(end)}`
const name = (lead: string) => redactContactDetails(lead).trim() || 'ליד'

export const MEETING_COPY = {
  askDate: 'לאיזה יום לקבוע את הפגישה? אפשר לכתוב למשל: מחר, יום שלישי, או 27.10',
  askTime: 'באיזו שעה? אפשר לכתוב למשל 10:00',
  ambiguousTime: 'לא בטוח לאיזו שעה התכוונת (בוקר או ערב). אפשר לכתוב שעה מלאה, למשל 17:00',
  ambiguousDate: 'לא בטוח לאיזה יום התכוונת. אפשר לכתוב יום ושעה, למשל: מחר ב-10:00 או 27.10 ב-10:00',
  pastDate: 'המועד הזה כבר עבר. לאיזה יום ושעה לקבוע?',
  mismatch: 'רציתי לוודא את המועד לפני שקובעים. אפשר לכתוב את היום והשעה במדויק, למשל: מחר ב-10:00',
  leadNotAllowed: 'לא מצאתי את הליד הזה בין הלידים שלך, אז לא קבעתי פגישה. אפשר לבדוק את השם ולנסות שוב.',
  notPrepared: 'לא הצלחתי להכין את הפגישה הפעם, ולא נקבע דבר. אפשר לנסות שוב בעוד רגע או לקבוע ב-SocialCRM: ' + CALENDAR_LINK,
  useButtons: 'כדי לאשר או לבטל, לחצו על הכפתור בהודעה עם פרטי הפגישה.',
  rejected: 'בוטל. לא נקבעה פגישה.',
  expired: 'האישור פג תוקף (15 דקות), ולא נקבעה פגישה. אפשר לבקש שוב.',
  superseded: 'יש בקשה חדשה יותר. אפשר לאשר אותה בהודעה האחרונה.',
  alreadyDecided: 'הבקשה הזו כבר טופלה.',
  notFound: 'לא מצאתי בקשה פתוחה לאשר.',
  changed: 'פרטי הבקשה השתנו, ולכן היא לא בוצעה. אפשר לבקש שוב.',
  unverified: 'לא הצלחתי לאמת שהפגישה נשמרה. כדאי לבדוק ביומן ב-SocialCRM לפני שמבקשים שוב: ' + CALENDAR_LINK,
  notAuthorized: 'אין לך הרשאה לקבוע פגישה לליד הזה, ולכן לא נקבע דבר.',
  failed: 'הפגישה לא נקבעה. אפשר לנסות שוב או לקבוע ב-SocialCRM: ' + CALENDAR_LINK,
} as const

export function confirmationCard(input: {
  lead: string
  date: string
  start: Date
  end: Date
  durationMinutes: number
  googleConnected: boolean
}): string {
  return [
    '*לקבוע את הפגישה?*',
    `ליד: ${name(input.lead)}`,
    `מועד: ${hebrewDateLabel(input.date)}, ${span(input.start, input.end)}`,
    `משך: ${input.durationMinutes} דקות`,
    input.googleConnected ? 'יומן: SocialCRM, ואחרי האישור גם יומן Google שלך' : 'יומן: SocialCRM בלבד (יומן Google לא מחובר)',
    'בדקתי חפיפה מול הפגישות שלך ב-SocialCRM בלבד, לא מול יומן Google.',
    'האישור בתוקף ל-15 דקות.',
  ].join('\n')
}

export function decisionButtons(token: string): ReplyButton[] {
  return [
    { id: `wa:approve:${token}`, title: APPROVE_TITLE },
    { id: `wa:reject:${token}`, title: REJECT_TITLE },
  ]
}

export function conflictReply(conflict: { startAt: Date; endAt: Date }, free: readonly string[]): string {
  const lines = [`בשעה הזו כבר יש לך פגישה ב-SocialCRM (${span(conflict.startAt, conflict.endAt)}), ולכן לא קבעתי.`]
  lines.push(free.length ? `שעות פנויות באותו יום לפי SocialCRM: ${free.join(', ')}. אפשר לכתוב לי איזו מתאימה.` : 'לא מצאתי שעה פנויה באותו יום לפי SocialCRM. אפשר לבחור יום אחר.')
  return lines.join('\n')
}

const GOOGLE_LINE: Record<GoogleState, string> = {
  synced: 'נוספה גם ליומן Google שלך.',
  not_connected: 'יומן Google לא מחובר, אז הפגישה נשמרה ב-SocialCRM בלבד.',
  failed: 'לא הצלחתי להוסיף אותה ליומן Google. אפשר לנסות שוב מעמוד היומן ב-SocialCRM.',
  reauth_required: 'לא נוספה ליומן Google כי צריך לחבר אותו מחדש בהגדרות.',
  unconfirmed: 'עדיין אין אישור שהיא נוספה ליומן Google. כדאי לבדוק ביומן.',
}

/** Built ONLY from the re-read meeting row. */
export function successReply(input: { already: boolean; lead: string; start: Date; end: Date; date: string; google: GoogleState }): string {
  return [
    input.already ? '*הפגישה הזו כבר נקבעה ב-SocialCRM*' : '*הפגישה נקבעה ב-SocialCRM*',
    `ליד: ${name(input.lead)}`,
    `מועד: ${hebrewDateLabel(input.date)}, ${span(input.start, input.end)}`,
    GOOGLE_LINE[input.google],
    `לפרטים: ${CALENDAR_LINK}`,
  ].join('\n')
}
