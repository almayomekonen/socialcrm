import { redactContactDetails } from '../render'
import { REJECT_TITLE } from '../meetings/copy'
import { ils } from '@/lib/quotes/pdf/format'
import type { ReplyButton } from '@/lib/whatsapp/platform/sendText'

/**
 * Every sentence about reviewing and sending a quote. Pure. Nothing here says
 * "sent" without a provider answer, and the owner sees only the last digits of
 * the customer's number.
 */

export const APPROVE_SEND_TITLE = 'לאשר ולשלוח'
export const EDIT_QUOTE_TITLE = 'לערוך'
export const APPROVE_EDIT_TITLE = 'לאשר שינוי'

const name = (s: string | null | undefined) => redactContactDetails(s ?? '').trim() || 'ליד'
export const maskedPhone = (e164: string) => `מספר שמסתיים ב-${e164.replace(/\D/g, '').slice(-4)}`

export const DELIVERY_COPY = {
  editPrompt: 'מה לשנות? אפשר לכתוב למשל: "תשנה את המחיר ל-20,000", "תוסיף התקנה ב-500", "תן 10% הנחה". ההצעה לא תישלח ללקוח עד שתאשרו את הגרסה החדשה.',
  noQuote: 'לא מצאתי הצעת מחיר שממתינה לבדיקה. אפשר לבקש הצעה חדשה.',
  notAllowed: 'אין לך הרשאה לערוך את ההצעה הזו, ולכן לא שיניתי דבר.',
  noSendPermission: 'אין לך הרשאה לשלוח הצעות מחיר ללקוחות. ההצעה נשמרה ב-SocialCRM.',
  noCustomerNumber: 'לליד הזה אין מספר וואטסאפ, ולכן אי אפשר לשלוח לו את ההצעה מכאן. אפשר להוסיף מספר בכרטיס הליד ולבקש "תראה לי שוב את ההצעה".',
  noConnection: 'כדי לשלוח הצעה ללקוח צריך לחבר את הוואטסאפ העסקי ב-SocialCRM. ההצעה נשמרה.',
  optedOut: 'הליד ביקש להפסיק לקבל הודעות מהעסק, ולכן ההצעה לא תישלח אליו בוואטסאפ.',
  windowClosed: 'הליד לא כתב לעסק ב-24 השעות האחרונות, ואין עדיין תבנית וואטסאפ מאושרת לשליחת הצעות מחיר, ולכן אי אפשר לשלוח אותה כרגע. ההצעה נשמרה ב-SocialCRM.',
  quoteExpired: 'תוקף ההצעה הזו עבר, ולכן אי אפשר לשלוח אותה. אפשר לעדכן את התוקף, למשל: "בתוקף ל-30 יום".',
  pdfPending: 'קובץ ה-PDF של ההצעה בהכנה. כשיהיה מוכן הוא יגיע לכאן לבדיקה.',
  pdfUnavailable: 'לא הצלחתי להציג את קובץ ההצעה כרגע, ולכן לא ביקשתי אישור לשלוח אותה. אפשר לנסות שוב בעוד רגע.',
  notSent: 'לא נשלח דבר ללקוח.',
  declined: 'בוטל. ההצעה נשמרה ב-SocialCRM ולא נשלחה ללקוח.',
  expired: 'האישור פג תוקף, והצעת המחיר לא נשלחה. אפשר לכתוב "תראה לי שוב את ההצעה".',
  superseded: 'זו כבר לא הגרסה האחרונה של ההצעה, ולכן היא לא נשלחה. אפשר לאשר את הגרסה האחרונה.',
  alreadyDecided: 'הבקשה הזו כבר טופלה.',
  notFound: 'לא מצאתי בקשה פתוחה לאשר.',
  stale: 'משהו השתנה מאז שהכנתי את התצוגה (הגרסה, הקובץ או מספר הלקוח), ולכן ההצעה לא נשלחה. אפשר לכתוב "תראה לי שוב את ההצעה".',
  alreadySent: 'ההצעה הזו כבר נשלחה ללקוח, ולא שלחתי אותה שוב.',
  sendFailed: 'וואטסאפ לא קיבל את ההודעה, וההצעה לא נשלחה ללקוח. אפשר לכתוב "תראה לי שוב את ההצעה" כדי לנסות שוב.',
  sendUnknown: 'לא הצלחתי לוודא אם ההצעה נשלחה ללקוח, ולכן לא אשלח אותה שוב. כדאי לבדוק בשיחה עם הליד ב-SocialCRM.',
  editDeclined: 'השינוי בוטל. ההצעה נשארה כפי שהייתה.',
  editStale: 'ההצעה השתנתה או כבר נשלחה מאז שהכנתי את השינוי, ולכן לא שיניתי דבר.',
  editFailed: 'לא הצלחתי לעדכן את ההצעה, והיא נשארה כפי שהייתה. אפשר לנסות שוב.',
  editUnverified: 'לא הצלחתי לאמת שההצעה עודכנה. כדאי לבדוק לפני שמבקשים שוב.',
  askWhichLine: 'איזה פריט לשנות? אפשר לכתוב את שם הפריט או את המספר שלו.',
  lineNotFound: 'לא מצאתי פריט כזה בהצעה. אפשר לכתוב את שם הפריט כפי שהוא מופיע.',
  askNewPrice: 'מה המחיר? כתבו את הסכום במספרים, למשל 18,500.',
  noChange: 'לא מצאתי מה לשנות בהצעה. אפשר לכתוב במדויק מה לעדכן.',
  noLinesLeft: 'אי אפשר להסיר את כל הפריטים מההצעה.',
  discountTooHigh: 'ההנחה גדולה מהמחיר של הפריט, ולכן לא שיניתי דבר.',
} as const

export function quoteSendCard(input: { lead: string; quoteNumber: number | null; version: number; totalAmount: number; recipient: string; phoneE164: string; ttlHours: number }): string {
  return [
    '*טיוטת הצעת המחיר מוכנה לבדיקה*',
    input.quoteNumber != null ? `מספר הצעה: ${input.quoteNumber}${input.version > 1 ? ` (גרסה ${input.version})` : ''}` : null,
    `ליד: ${name(input.lead)}`,
    `סה"כ: ${ils(input.totalAmount)}`,
    `תישלח אל: ${name(input.recipient)}, ${maskedPhone(input.phoneE164)}`,
    'אחרי האישור הליד יקבל בוואטסאפ קישור לקובץ המצורף, בדיוק כפי שהוא.',
    'שום דבר לא יישלח ללקוח לפני שתאשרו.',
    `האישור בתוקף ל-${input.ttlHours} שעות.`,
  ]
    .filter(Boolean)
    .join('\n')
}

export function quoteSendButtons(token: string): ReplyButton[] {
  return [
    { id: `wa:approve:${token}`, title: APPROVE_SEND_TITLE },
    { id: `wa:edit:${token}`, title: EDIT_QUOTE_TITLE },
    { id: `wa:reject:${token}`, title: REJECT_TITLE },
  ]
}

export function quoteEditButtons(token: string): ReplyButton[] {
  return [
    { id: `wa:approve:${token}`, title: APPROVE_EDIT_TITLE },
    { id: `wa:reject:${token}`, title: REJECT_TITLE },
  ]
}

/** Built only from a provider's acceptance and the re-read delivery. */
export const quoteSentReply = (input: { quoteNumber: number | null; phoneE164Masked: string }) =>
  [`*הצעת המחיר נשלחה ללקוח*${input.quoteNumber != null ? ` (מספר ${input.quoteNumber})` : ''}`, `נשלחה ל${input.phoneE164Masked}.`, 'וואטסאפ קיבל את ההודעה. אעדכן כאן כשהיא תימסר.'].join('\n')

export const quoteEditedReply = (input: { quoteNumber: number | null; version: number; totalAmount: number; pdfPending: boolean }) =>
  [
    '*ההצעה עודכנה*',
    input.quoteNumber != null ? `מספר הצעה: ${input.quoteNumber} (גרסה ${input.version})` : null,
    `סה"כ: ${ils(input.totalAmount)}`,
    'האישור הקודם לשליחה בוטל.',
    // The sweep renders a lost or failed start too, so a new PDF (or a failure notice) always follows.
    input.pdfPending ? 'קובץ PDF חדש בהכנה, ויגיע לכאן לבדיקה ולאישור.' : 'קובץ PDF חדש יגיע לכאן לבדיקה ולאישור.',
    'לא נשלח דבר ללקוח.',
  ]
    .filter(Boolean)
    .join('\n')

export const quoteDeliveredNotice = (quoteNumber: number | null) => `*הצעת המחיר נמסרה ללקוח*${quoteNumber != null ? ` (מספר ${quoteNumber})` : ''}`

export const quoteDeliveryFailedNotice = (quoteNumber: number | null) =>
  [`*הצעת המחיר לא נמסרה ללקוח*${quoteNumber != null ? ` (מספר ${quoteNumber})` : ''}`, 'וואטסאפ דיווח שההודעה לא הגיעה. הקישור בוטל.', 'אפשר לכתוב "תראה לי שוב את ההצעה" כדי לנסות שוב.'].join('\n')

/** To the CUSTOMER. No amounts, so a forwarded message says nothing beyond the link. */
export const quoteCustomerMessage = (input: { name: string; quoteNumber: number | null; business: string; link: string }) =>
  [`שלום${input.name.trim() ? ` ${input.name.trim()}` : ''},`, `הצעת מחיר${input.quoteNumber != null ? ` מספר ${input.quoteNumber}` : ''}${input.business.trim() ? ` מאת ${input.business.trim()}` : ''} מוכנה לצפייה:`, input.link].join('\n')

/** What the Inbox keeps: the link is a bearer capability and stays out of the conversation history. */
export const quoteInboxSummary = (quoteNumber: number | null) => `[הצעת מחיר${quoteNumber != null ? ` מספר ${quoteNumber}` : ''} נשלחה בוואטסאפ]`
