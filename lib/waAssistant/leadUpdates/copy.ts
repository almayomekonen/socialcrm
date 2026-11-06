import { redactContactDetails } from '../render'
import { REJECT_TITLE } from '../meetings/copy'
import { leadStatusLabel } from '@/lib/leads/statusStyles'
import { LEAD_STATUSES } from '@/lib/mcp/present'
import type { ReplyButton } from '@/lib/whatsapp/platform/sendText'

/**
 * Every WhatsApp sentence about a status change or a note. Pure. Facts come
 * only from the caller's persisted data (the action's stored arguments, the
 * lead row); nothing here says "done" unless the caller holds a verified outcome.
 * Status names are the product's own labels (lib/leads/statusStyles.ts).
 */

export const LEADS_LINK = 'https://getsocialcrm.com/leads'
export const APPROVE_STATUS_TITLE = 'לאשר ולעדכן'
export const APPROVE_NOTE_TITLE = 'לאשר ולהוסיף'

const name = (lead: string) => redactContactDetails(lead).trim() || 'ליד'
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
export const statusName = (code: string | null) => (code ? leadStatusLabel(code, 'he') ?? code : 'ללא סטטוס')
const ALL_STATUSES = LEAD_STATUSES.map((s) => statusName(s)).join(', ')

export const LEAD_UPDATE_COPY = {
  askLead: 'לאיזה ליד?',
  askStatus: `לאיזה סטטוס? ${ALL_STATUSES}.`,
  askNote: 'מה לרשום בהערה?',
  useButtons: 'כדי לאשר או לבטל, לחצו על הכפתור בהודעה האחרונה עם פרטי הבקשה.',
  leadNotAllowed: 'לא מצאתי את הליד הזה בין הלידים שלך, אז לא שיניתי דבר. אפשר לבדוק את השם ולנסות שוב.',
  notPrepared: 'לא הצלחתי להכין את הבקשה הפעם, ולא שיניתי דבר. אפשר לנסות שוב בעוד רגע או ב-SocialCRM: ' + LEADS_LINK,
  rejected: 'בוטל. לא שיניתי דבר.',
  expired: 'האישור פג תוקף (15 דקות), ולא שיניתי דבר. אפשר לבקש שוב.',
  superseded: 'יש בקשה חדשה יותר. אפשר לאשר אותה בהודעה האחרונה.',
  alreadyDecided: 'הבקשה הזו כבר טופלה.',
  notFound: 'לא מצאתי בקשה פתוחה לאשר.',
  changed: 'פרטי הבקשה השתנו, ולכן היא לא בוצעה. אפשר לבקש שוב.',
  staleStatus: 'הסטטוס של הליד השתנה מאז שהבקשה הוכנה, ולכן לא עדכנתי אותו. אפשר לבקש שוב.',
  unverified: 'לא הצלחתי לאמת שהשינוי נשמר. כדאי לבדוק ב-SocialCRM לפני שמבקשים שוב: ' + LEADS_LINK,
  notAuthorized: 'אין לך הרשאה לליד הזה, ולכן לא שיניתי דבר.',
  failed: 'הבקשה לא בוצעה. אפשר לנסות שוב או ב-SocialCRM: ' + LEADS_LINK,
} as const

export function alreadyInStatus(lead: string, status: string): string {
  return `${name(lead)} כבר בסטטוס ${statusName(status)}. לא שיניתי דבר.`
}

export function statusCard(input: { lead: string; from: string | null; to: string; automations: boolean }): string {
  const lines = ['*לעדכן סטטוס?*', `ליד: ${name(input.lead)}`, `סטטוס נוכחי: ${statusName(input.from)}`, `סטטוס חדש: ${statusName(input.to)}`]
  // The business's own automations may message the lead on a status change: the owner must know before tapping.
  if (input.automations) lines.push('שימו לב: לעסק יש אוטומציות פעילות לשינוי סטטוס, והן יופעלו.')
  lines.push('האישור בתוקף ל-15 דקות.')
  return lines.join('\n')
}

export function noteCard(input: { lead: string; content: string }): string {
  return [
    '*להוסיף הערה לליד?*',
    `ליד: ${name(input.lead)}`,
    `הערה: ${clip(input.content, 400)}`,
    'ההערה תתווסף להערות הקיימות של הליד.',
    'האישור בתוקף ל-15 דקות.',
  ].join('\n')
}

export function leadUpdateButtons(token: string, kind: 'status' | 'note'): ReplyButton[] {
  return [
    { id: `wa:approve:${token}`, title: kind === 'status' ? APPROVE_STATUS_TITLE : APPROVE_NOTE_TITLE },
    { id: `wa:reject:${token}`, title: REJECT_TITLE },
  ]
}

/** Built ONLY from a verified outcome and the re-read lead. */
export function statusSuccessReply(input: { lead: string; status: string; already: boolean }): string {
  return [
    input.already ? '*הליד כבר היה בסטטוס הזה*' : '*הסטטוס עודכן ב-SocialCRM*',
    `ליד: ${name(input.lead)}`,
    `סטטוס: ${statusName(input.status)}`,
    `לפרטים: ${LEADS_LINK}`,
  ].join('\n')
}

export function noteSuccessReply(input: { lead: string; already: boolean }): string {
  return [
    input.already ? '*ההערה הזו כבר נשמרה ב-SocialCRM*' : '*ההערה נשמרה ב-SocialCRM*',
    `ליד: ${name(input.lead)}`,
    'אפשר לראות אותה בהערות ושיחות של הליד.',
  ].join('\n')
}
