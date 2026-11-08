import { redactContactDetails } from '../render'
import { REJECT_TITLE } from '../meetings/copy'
import { formatQty } from '@/lib/billing/pdf/format'
import { ils, unitIls } from '@/lib/quotes/pdf/format'
import type { ReplyButton } from '@/lib/whatsapp/platform/sendText'
import type { QuoteTotals } from '@/lib/quotes/totals'
import type { PricedOwnerLine } from '@/lib/quotes/ownerPricing'

/**
 * Every WhatsApp sentence about a quote. Pure. Every amount comes from the
 * caller's computed totals (the same `computeQuoteTotals` the write stores) or
 * from the re-read quote row; nothing here says "created" without a verified
 * outcome, and nothing ever says "sent": quotes are never sent from WhatsApp.
 */

export const APPROVE_QUOTE_TITLE = 'לאשר וליצור'

const name = (s: string) => redactContactDetails(s).trim() || 'ליד'

export const QUOTE_COPY = {
  askLead: 'לאיזה ליד להכין את הצעת המחיר?',
  askItems: 'על מה הצעת המחיר, ובאיזה מחיר?',
  askPrice: 'מה המחיר? כתבו את הסכום במספרים, למשל 18,500.',
  askFree: 'הסכום שנרשם הוא ₪0. זו הצעה בחינם? אם כן, כתבו "בחינם". אם לא, כתבו את המחיר.',
  askDiscount: 'כמה הנחה לתת? אפשר סכום או אחוז במספרים, למשל 10%.',
  askVat: 'המחיר כולל מע"מ או לפני מע"מ?',
  askValidity: 'לכמה ימים ההצעה בתוקף? אפשר גם בלי תוקף.',
  notAllowed: 'אין לך הרשאה ליצור הצעות מחיר, ולכן לא יצרתי דבר.',
  leadNotAllowed: 'לא מצאתי את הליד הזה בין הלידים שלך, אז לא יצרתי הצעת מחיר. אפשר לבדוק את השם ולנסות שוב.',
  // No screen sets a per-agency VAT rate today: the copy must not point to one.
  taxMissing: 'לא מוגדר שיעור מע"מ לעסק ב-SocialCRM, ולכן לא יצרתי הצעת מחיר. אפשר לפנות אלינו כדי להגדיר אותו.',
  tooLongForCard: 'יש יותר מדי פרטים כדי להציג אותם במלואם בכרטיס אישור אחד, ולכן לא יצרתי הצעת מחיר. אפשר לבקש שוב עם פחות פריטים.',
  tooManyLines: 'אפשר עד 50 פריטים בהצעת מחיר אחת, ולכן לא יצרתי אותה.',
  notPrepared: 'לא הצלחתי להכין את הצעת המחיר הפעם, ולא יצרתי דבר. אפשר לנסות שוב בעוד רגע.',
  rejected: 'בוטל. לא נוצרה הצעת מחיר.',
  expired: 'האישור פג תוקף (15 דקות), ולא נוצרה הצעת מחיר. אפשר לבקש שוב.',
  superseded: 'יש בקשה חדשה יותר. אפשר לאשר אותה בהודעה האחרונה.',
  alreadyDecided: 'הבקשה הזו כבר טופלה.',
  notFound: 'לא מצאתי בקשה פתוחה לאשר.',
  changed: 'פרטי הבקשה השתנו, ולכן היא לא בוצעה. אפשר לבקש שוב.',
  staleTotals: 'המע"מ של העסק השתנה מאז שהכרטיס הוכן, ולכן לא יצרתי את ההצעה בסכום אחר מזה שאישרת. אפשר לבקש שוב.',
  unverified: 'לא הצלחתי לאמת שהצעת המחיר נשמרה. כדאי לבדוק לפני שמבקשים שוב.',
  notAuthorized: 'אין לך הרשאה לליד הזה, ולכן לא יצרתי הצעת מחיר.',
  failed: 'הצעת המחיר לא נוצרה. אפשר לנסות שוב.',
} as const

const BASIS_LABEL = { incl_vat: 'המחירים שנמסרו כוללים מע"מ', excl_vat: 'המחירים שנמסרו לפני מע"מ', no_vat: 'העסק פטור ממע"מ' } as const

export function quoteCard(input: {
  lead: string
  title: string
  lines: readonly PricedOwnerLine[]
  /** The percent the owner stated for each line, or null. */
  discountPercents?: readonly (number | null)[]
  totals: QuoteTotals
  basis: 'incl_vat' | 'excl_vat' | 'no_vat'
  ratePercent: number
  requestedTotal: number
  exact: boolean
  validityDays: number | null
}): string {
  const { totals } = input
  const out = ['*ליצור הצעת מחיר?*', `ליד: ${name(input.lead)}`, `נושא: ${name(input.title)}`, 'פריטים:']
  input.lines.forEach((l, i) => {
    const percent = input.discountPercents?.[i]
    const discount = l.discount > 0 ? `, הנחה ${percent != null ? `${formatQty(percent)}% (${ils(l.discount)})` : ils(l.discount)}` : ''
    out.push(`${i + 1}. ${name(l.title)}: ${formatQty(l.quantity)} × ${unitIls(l.unitPrice)}${discount} = ${ils(totals.lines[i].lineSubtotal)}`)
  })
  out.push(`(מחירי הפריטים לפני מע"מ. ${BASIS_LABEL[input.basis]}.)`)
  out.push(`סכום לפני מע"מ: ${ils(totals.subtotalAmount)}`)
  if (totals.discountAmount > 0) out.push(`הנחות: ${ils(totals.discountAmount)}`)
  out.push(`מע"מ (${formatQty(input.ratePercent)}%): ${ils(totals.taxAmount)}`)
  out.push(`*סה"כ: ${ils(totals.totalAmount)}*`)
  if (!input.exact) {
    out.push(`שימו לב: בגלל עיגול לאגורות הסכום שיישמר הוא ${ils(totals.totalAmount)}, ולא ${ils(input.requestedTotal)} שנמסר.`)
  }
  if (input.validityDays != null) out.push(`תוקף: ${input.validityDays} ימים`)
  out.push('ההצעה תישמר ב-SocialCRM. היא לא תישלח ללקוח.')
  out.push('האישור בתוקף ל-15 דקות.')
  return out.join('\n')
}

export function quoteButtons(token: string): ReplyButton[] {
  return [
    { id: `wa:approve:${token}`, title: APPROVE_QUOTE_TITLE },
    { id: `wa:reject:${token}`, title: REJECT_TITLE },
  ]
}

/** Built ONLY from a verified outcome and the re-read quote. */
export function quoteSuccessReply(input: { lead: string; quoteNumber: number | null; totalAmount: number; already: boolean; pdfPending: boolean }): string {
  return [
    input.already ? '*הצעת המחיר הזו כבר נוצרה*' : '*הצעת המחיר נוצרה ב-SocialCRM*',
    `ליד: ${name(input.lead)}`,
    input.quoteNumber != null ? `מספר הצעה: ${input.quoteNumber}` : null,
    `סה"כ: ${ils(input.totalAmount)}`,
    'ההצעה לא נשלחה ללקוח.',
    input.pdfPending ? 'קובץ PDF בהכנה, וקישור להורדה יגיע כאן בהודעה נפרדת.' : null,
  ]
    .filter(Boolean)
    .join('\n')
}

/** Follow-ups to the OWNER only. Built from the stored quote; the link needs a SocialCRM login. */
export function quotePdfReadyNotice(input: { quoteNumber: number | null; totalAmount: number; link: string }): string {
  return [
    '*קובץ הצעת המחיר מוכן*',
    input.quoteNumber != null ? `מספר הצעה: ${input.quoteNumber}` : null,
    `סה"כ: ${ils(input.totalAmount)}`,
    `להורדה: ${input.link}`,
    'הקישור נפתח אחרי התחברות ל-SocialCRM. אם נדרשת התחברות, אפשר ללחוץ עליו שוב אחריה.',
    'ההצעה לא נשלחה ללקוח.',
  ]
    .filter(Boolean)
    .join('\n')
}

export function quotePdfFailedNotice(input: { quoteNumber: number | null }): string {
  return [
    '*לא הצלחתי להכין את קובץ ה-PDF של הצעת המחיר*',
    input.quoteNumber != null ? `מספר הצעה: ${input.quoteNumber}` : null,
    'ההצעה עצמה נשמרה ב-SocialCRM, ולא נוצרה הצעה נוספת. היא לא נשלחה ללקוח.',
    'אפשר לפנות אלינו ונכין את הקובץ.',
  ]
    .filter(Boolean)
    .join('\n')
}
