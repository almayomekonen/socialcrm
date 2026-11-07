import { businessDateString } from '@/lib/today/time'
import { REMINDER_HORIZON_MS, type ReminderWhenAsk } from '@/lib/reminders/when'
import { REMINDER_MAX_PER_RECIPIENT_DAY, REMINDER_MAX_SCHEDULED_PER_USER } from '@/lib/reminders/limits'
import type { ReplyButton } from '@/lib/whatsapp/platform/sendText'
import { CONNECT_LINK, redactContactDetails } from '../render'
import { hebrewDateLabel } from '../meetings/when'
import { REJECT_TITLE } from '../meetings/copy'

/**
 * Every WhatsApp sentence about a personal reminder. Pure. Times come only from
 * the reader's result or the persisted row; nothing here says "scheduled" unless
 * the caller holds a verified outcome. Product copy, not consent wording: the
 * consent text itself lives in lib/whatsapp/platform/consentText.ts, unchanged.
 */

export const APPROVE_REMINDER_TITLE = 'לאשר ולקבוע'
export const APPROVE_CANCEL_TITLE = 'לבטל את התזכורת'
export const KEEP_TITLE = 'להשאיר'
export const APPROVE_RESCHEDULE_TITLE = 'לאשר ולהזיז'
export const REMINDER_TEXT_MAX = 300

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
const said = (text: string | null) => clip(redactContactDetails(text ?? '').trim() || 'תזכורת', 200)

/** "היום ב-14:35" / "מחר ב-09:00" / "יום שני, 09.11.2026, ב-09:00", in the business timezone, relative to `fromMs`. */
export function whenLabel(atMs: number, fromMs: number): string {
  const date = businessDateString(atMs)
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).format(new Date(atMs))
  const today = businessDateString(fromMs)
  const tomorrow = businessDateString(fromMs + 24 * 60 * 60 * 1000)
  const day = date === today ? 'היום' : date === tomorrow ? 'מחר' : hebrewDateLabel(date)
  return `${day} ב-${time}`
}

export const REMINDER_COPY = {
  consent: `כדי שאוכל לשלוח לך תזכורות בזמן שתבקש, צריך לאשר את זה פעם אחת בהגדרות: ${CONNECT_LINK}`,
  unverified: 'לא הצלחתי לאמת את זמן ההודעה, אפשר לשלוח שוב?',
  askText: 'מה להזכיר לך?',
  tooLong: `התזכורת ארוכה מדי. אפשר לקצר אותה ל-${REMINDER_TEXT_MAX} תווים ולשלוח שוב.`,
  scheduledLimit: `יש לך כבר ${REMINDER_MAX_SCHEDULED_PER_USER} תזכורות מתוזמנות. אפשר לבטל אחת ולנסות שוב.`,
  handled: 'הבקשה הזו כבר טופלה. כדי לקבוע תזכורת, שלחו בקשה חדשה.',
  notPrepared: 'לא הצלחתי להכין את התזכורת הפעם, ולא נקבע דבר. אפשר לנסות שוב בעוד רגע.',
  rejected: 'בוטל. לא נקבעה תזכורת.',
  kept: 'בסדר, התזכורת נשארת כמו שהיא.',
  expired: 'האישור פג תוקף (15 דקות), ולא שונה דבר. אפשר לבקש שוב.',
  superseded: 'יש בקשה חדשה יותר. אפשר לאשר אותה בהודעה האחרונה.',
  alreadyDecided: 'הבקשה הזו כבר טופלה.',
  notFound: 'לא מצאתי בקשה פתוחה לאשר.',
  noLongerValid: 'הבקשה כבר לא בתוקף. אפשר לבקש שוב.',
  changed: 'פרטי התזכורת השתנו בינתיים, ולכן הבקשה לא בוצעה. אפשר לבקש שוב.',
  tooLate: 'הזמן של התזכורת כבר עבר או קרוב מדי, ולכן היא לא נקבעה. אפשר לבקש שוב עם זמן אחר.',
  overLimit: 'הגעת למגבלת התזכורות, ולכן הבקשה לא בוצעה.',
  unverifiedOutcome: 'לא הצלחתי לאמת שהבקשה נשמרה. אפשר לכתוב "מה התזכורות שלי" כדי לבדוק לפני שמבקשים שוב.',
  failed: 'הבקשה לא בוצעה. אפשר לנסות שוב בעוד רגע.',
  inFlight: 'התזכורת כבר בדרך אליך, ואי אפשר לעצור אותה עכשיו.',
  alreadySent: 'התזכורת הזו כבר נשלחה.',
  notCancellable: 'התזכורת הזו כבר לא פעילה.',
  none: 'אין לך תזכורות קרובות. אפשר לכתוב למשל: "בעוד שעה תזכיר לי להתקשר לאבי".',
  noMatch: 'לא מצאתי תזכורת קרובה שמתאימה.',
  askWhichCancel: 'איזו לבטל? אפשר לכתוב את השעה שלה.',
  askWhichMove: 'איזו להזיז? אפשר לכתוב למשל: "תזיז את התזכורת של 14:35 ל-16:00".',
  askNewTime: 'לאיזו שעה להזיז?',
  /** What the assistant can do with personal reminders. True whatever the delivery switch; it promises no delivery. */
  capability:
    'כן. אפשר לקבוע כאן תזכורות אישיות, ולהציג, להזיז או לבטל אותן. למשל: "בעוד שעה תזכיר לי להתקשר לאבי", "מה התזכורות שלי", "תבטל את התזכורת להתקשר לאבי". כל שינוי נעשה רק אחרי אישור בכרטיס.',
} as const

/** ONE short question about the one thing that is unclear in WHEN. */
export function reminderWhenQuestion(ask: ReminderWhenAsk, ctx: { hour?: number; anchorMs: number }): string {
  switch (ask) {
    case 'unverified_anchor':
      return REMINDER_COPY.unverified
    case 'ask_when':
      return 'מתי להזכיר לך? למשל: בעוד שעה, או היום ב-17:00.'
    case 'ask_time':
      return 'באיזו שעה?'
    case 'ambiguous_time':
      return ctx.hour !== undefined ? `ב-${ctx.hour} בבוקר או בערב?` : 'לא הבנתי את השעה. אפשר לכתוב אותה כך: 17:30.'
    case 'ambiguous_date':
      return 'לאיזה יום?'
    case 'ambiguous_offset':
      return 'בעוד כמה זמן בדיוק? למשל: בעוד 20 דקות.'
    case 'conflicting':
      return 'כתבת גם "בעוד…" וגם שעה. מתי להזכיר לך?'
    case 'past':
      return 'הזמן הזה כבר עבר. לאיזו שעה לקבוע?'
    case 'too_soon':
      return 'זה קרוב מדי. אפשר לקבוע תזכורת ליותר מדקה מעכשיו.'
    case 'beyond_horizon':
      return `כרגע אפשר לקבוע תזכורת עד 23 שעות קדימה (עד ${whenLabel(ctx.anchorMs + REMINDER_HORIZON_MS, ctx.anchorMs)}).`
  }
}

export function dailyLimit(atMs: number): string {
  return `הגעת למקסימום של ${REMINDER_MAX_PER_RECIPIENT_DAY} תזכורות ל${hebrewDateLabel(businessDateString(atMs))}.`
}

export const alreadyScheduled = (atMs: number, fromMs: number) => `כבר קבעתי את התזכורת הזו ל${whenLabel(atMs, fromMs)}.`

/**
 * What the owner is told about delivery. Never a promise the system cannot keep:
 * while automatic delivery is unavailable, the reminder is saved in SocialCRM and
 * the owner is told that no message will come. No switch or setting is named.
 */
export const DELIVERY_ON = 'אשלח לך הודעה כאן בזמן הזה.'
export const DELIVERY_OFF = 'התזכורת תישמר ב-SocialCRM, אבל כרגע לא תישלח עליה הודעה אוטומטית כאן.'
export const SAVED_DELIVERY_OFF = 'התזכורת שמורה ב-SocialCRM. כרגע לא תישלח עליה הודעה אוטומטית כאן.'

export function createCard(input: { text: string; atMs: number; fromMs: number; delivery: boolean }): string {
  return ['*לקבוע תזכורת?*', `תזכורת: ${said(input.text)}`, `מתי: ${whenLabel(input.atMs, input.fromMs)}`, input.delivery ? DELIVERY_ON : DELIVERY_OFF, 'האישור בתוקף ל-15 דקות.'].join('\n')
}

export function cancelCard(input: { text: string | null; atMs: number; fromMs: number }): string {
  return ['*לבטל את התזכורת?*', `תזכורת: ${said(input.text)}`, `מתי: ${whenLabel(input.atMs, input.fromMs)}`, 'האישור בתוקף ל-15 דקות.'].join('\n')
}

export function rescheduleCard(input: { text: string | null; fromAtMs: number; toAtMs: number; fromMs: number }): string {
  return [
    '*להזיז את התזכורת?*',
    `תזכורת: ${said(input.text)}`,
    `במקום: ${whenLabel(input.fromAtMs, input.fromMs)}`,
    `לזמן חדש: ${whenLabel(input.toAtMs, input.fromMs)}`,
    'האישור בתוקף ל-15 דקות.',
  ].join('\n')
}

export function reminderButtons(token: string, op: 'create' | 'cancel' | 'reschedule'): ReplyButton[] {
  const approve = op === 'create' ? APPROVE_REMINDER_TITLE : op === 'cancel' ? APPROVE_CANCEL_TITLE : APPROVE_RESCHEDULE_TITLE
  return [
    { id: `wa:approve:${token}`, title: approve },
    { id: `wa:reject:${token}`, title: op === 'create' ? REJECT_TITLE : KEEP_TITLE },
  ]
}

/** "1. היום ב-14:35 · להתקשר לאבי", soonest first. */
export function reminderLines(rows: { text: string | null; remindAtMs: number }[], fromMs: number): string[] {
  return rows.map((r, i) => `${i + 1}. ${whenLabel(r.remindAtMs, fromMs)} · ${said(r.text)}`)
}

export function listReply(rows: { text: string | null; remindAtMs: number }[], fromMs: number): string {
  if (!rows.length) return REMINDER_COPY.none
  return ['*התזכורות הקרובות שלך*', ...reminderLines(rows, fromMs), '', 'כדי לבטל או להזיז, כתבו למשל: "תבטל את התזכורת להתקשר לאבי".'].join('\n')
}

/** Built ONLY from a verified outcome and the re-read row. */
export function doneReply(op: 'create' | 'cancel' | 'reschedule', input: { text: string | null; atMs: number; fromMs: number; already?: boolean; delivery?: boolean }): string {
  const head =
    op === 'create' ? (input.already ? '*התזכורת הזו כבר קבועה*' : '*התזכורת נקבעה*')
    : op === 'cancel' ? (input.already ? '*התזכורת הזו כבר בוטלה*' : '*התזכורת בוטלה*')
    : '*התזכורת הוזזה*'
  const lines = [head, `תזכורת: ${said(input.text)}`, `${op === 'cancel' ? 'היה אמור להישלח' : 'מתי'}: ${whenLabel(input.atMs, input.fromMs)}`]
  if (op !== 'cancel' && input.delivery === false) lines.push(SAVED_DELIVERY_OFF)
  return lines.join('\n')
}
