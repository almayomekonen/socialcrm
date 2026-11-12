import { redactContactDetails } from '../render'
import { REJECT_TITLE } from '../meetings/copy'
import { ils } from '@/lib/quotes/pdf/format'
import type { ReplyButton } from '@/lib/whatsapp/platform/sendText'
import type { ConfirmedPayment } from '@/lib/integrations/providers/smartbee/payload'
import type { SmartbeeDocType, SmartbeeVatOption } from '@/lib/integrations/providers/smartbee/types'
import type { CustomerDelivery } from './customerDelivery'

/**
 * Every WhatsApp sentence about a SmartBee document. Pure. Nothing here says a
 * document was issued unless the caller passes a document SmartBee CONFIRMED
 * (result 102), with the number it returned. Nothing says it reached the
 * customer unless the caller passes that delivery's actual outcome
 * (./customerDelivery.ts).
 */

export const APPROVE_DOCUMENT_TITLE = 'לאשר ולהפיק'

export const DOC_TYPE_LABEL: Readonly<Record<SmartbeeDocType, string>> = {
  Invoice: 'חשבונית מס',
  Receipt: 'קבלה',
  InvoiceReceipt: 'חשבונית מס קבלה',
}

const METHOD_LABEL: Readonly<Record<ConfirmedPayment['method'], string>> = {
  cash: 'מזומן',
  credit_card: 'כרטיס אשראי',
  bank_transfer: 'העברה בנקאית',
  check: "צ'ק",
  other: 'אחר',
}

const name = (s: string) => redactContactDetails(s).trim() || 'ליד'

export const DOCUMENT_COPY = {
  askLead: 'לאיזה ליד להפיק את המסמך?',
  askType: 'איזה מסמך להפיק: חשבונית מס, קבלה, או חשבונית מס קבלה?',
  askAmount: 'מה הסכום? כתבו אותו במספרים, למשל 1,500.',
  askDescription: 'על מה המסמך? למשל "צילום חתונה".',
  askVat: 'הסכום כולל מע"מ או לפני מע"מ?',
  askInvoiceReceiptInclVat: 'לחשבונית מס קבלה צריך את הסכום הכולל מע"מ, כי זה הסכום ששולם. מה הסכום כולל מע"מ?',
  askPayment: 'איך שולם? מזומן, כרטיס אשראי, העברה בנקאית, צ\'ק, או ביט/פייבוקס?',
  askOnePayment: 'הוזכר יותר מאמצעי תשלום אחד. באיזה אמצעי שולם הסכום? אפשר מסמך אחד לכל אמצעי תשלום.',
  askCheckNumber: "מה מספר הצ'ק?",
  askInstallments: 'בכמה תשלומים? אפשר 1 עד 99.',
  typeNotAllowed: 'העסק רשום ב-SmartBee כעוסק פטור, ולכן אפשר להפיק רק קבלה. לא הפקתי דבר.',
  notOwner: 'רק בעל החשבון יכול להפיק מסמכים דרך SmartBee. לא הפקתי דבר.',
  notConnected: 'החיבור ל-SmartBee אינו פעיל כרגע, ולכן לא הפקתי דבר. אפשר לפנות אלינו כדי לחדש אותו.',
  leadNotAllowed: 'לא מצאתי את הליד הזה בין הלידים שלך, אז לא הפקתי מסמך.',
  leadNameInvalid: 'לליד חסר שם מלא תקין (2 עד 100 תווים), ולכן לא הפקתי מסמך. אפשר לעדכן את השם ב-SocialCRM ולנסות שוב.',
  invalid: 'הפרטים לא עומדים בדרישות של SmartBee, ולכן לא הפקתי מסמך. אפשר לבקש שוב עם הפרטים המדויקים.',
  tooLongForCard: 'יש יותר מדי פרטים כדי להציג אותם בכרטיס אישור אחד. אפשר לקצר את התיאור ולבקש שוב.',
  notPrepared: 'לא הצלחתי להכין את הבקשה הפעם, ולא הפקתי דבר. אפשר לנסות שוב בעוד רגע.',
  rejected: 'בוטל. לא הופק מסמך.',
  expired: 'האישור פג תוקף (15 דקות), ולא הופק מסמך. אפשר לבקש שוב.',
  superseded: 'יש בקשה חדשה יותר. אפשר לאשר אותה בהודעה האחרונה.',
  alreadyDecided: 'הבקשה הזו כבר טופלה.',
  notFound: 'לא מצאתי בקשה פתוחה לאשר.',
  changed: 'פרטי הבקשה או החיבור ל-SmartBee השתנו, ולכן לא הופק מסמך. אפשר לבקש שוב.',
  failed: 'לא הצלחתי למסור את הבקשה ל-SmartBee, ולא הופק מסמך.',
  unresolved: [
    'יש מסמך קודם עבור הליד הזה שלא ידוע אם הופק ב-SmartBee, ולכן לא אפיק מסמך נוסף עד שיתברר.',
    'אחרי בדיקה בחשבון ה-SmartBee כתבו "המסמך קיים" (אפשר להוסיף את מספר המסמך) או "המסמך לא קיים".',
  ].join('\n'),
  inFlight: 'יש בקשה קודמת למסמך עבור הליד הזה שעדיין ממתינה לאישור SmartBee. אעדכן כאן כשתתקבל תשובה, ורק אז אפשר לבקש מסמך נוסף.',
}

/** How the owner settles a stalled document. Only these words open the resolution card, and only a tap records it. */
const RESOLVE_HOW = 'אחרי הבדיקה כתבו כאן "המסמך קיים" (אפשר להוסיף את מספר המסמך) או "המסמך לא קיים". לא אפיק מסמך נוסף לליד הזה עד אז.'

export const RESOLVE_COPY = {
  notOwner: 'רק בעל החשבון המחובר ל-SmartBee יכול לסמן מה קרה למסמך. לא שיניתי דבר.',
  existsDone: 'נרשם שהמסמך קיים ב-SmartBee. לא יופק מסמך נוסף בשבילו.',
  absentDone: 'נרשם שהמסמך לא קיים ב-SmartBee. אפשר לבקש מסמך חדש לליד הזה.',
  alreadyResolved: 'המסמך הזה כבר סומן.',
  rejected: 'בוטל. לא נרשם דבר, והמסמך עדיין לא מסומן.',
  failed: 'לא הצלחתי לרשום את הבדיקה הפעם. לא שיניתי דבר. אפשר לנסות שוב.',
}

/** The card for a resolution. Built from the STORED row: what was requested, for whom, and what the owner says now. */
export function resolutionCard(input: { docType: SmartbeeDocType; customer: string; amount: number; requestedAt: Date; resolution: 'exists' | 'absent'; docIndex: string | null }): string {
  const label = DOC_TYPE_LABEL[input.docType]
  const day = new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit', year: 'numeric' }).format(input.requestedAt)
  return [
    input.resolution === 'exists' ? `*לסמן שה${label} קיימת ב-SmartBee?*` : `*לסמן שה${label} לא קיימת ב-SmartBee?*`,
    `לקוח: ${name(input.customer)}`,
    `סכום: ${ils(input.amount)}`,
    `נתבקשה ב-${day}`,
    input.resolution === 'exists' && input.docIndex ? `מספר מסמך ב-SmartBee: ${input.docIndex}` : null,
    input.resolution === 'exists'
      ? 'באישור את/ה מאשר/ת שבדקת ב-SmartBee והמסמך קיים. לא יופק מסמך נוסף בשבילו.'
      : 'באישור את/ה מאשר/ת שבדקת ב-SmartBee והמסמך לא קיים. אחר כך אפשר לבקש מסמך חדש לליד הזה.',
    'האישור בתוקף ל-15 דקות.',
  ]
    .filter(Boolean)
    .join('\n')
}

function paymentLine(p: ConfirmedPayment): string {
  const label = p.method === 'other' ? (p.otherLabel ?? METHOD_LABEL.other) : METHOD_LABEL[p.method]
  const extra =
    p.method === 'check' && p.checkNumber
      ? ` מספר ${p.checkNumber}`
      : p.method === 'credit_card'
        ? (p.installments ?? 1) > 1
          ? `, ${p.installments} תשלומים`
          : ', תשלום אחד'
        : p.method === 'bank_transfer' && p.reference
          ? `, אסמכתא ${p.reference}`
          : ''
  return `תשלום: ${ils(p.amount)} ב${label}${extra}`
}

/** The confirmation card. Every value is the APPLICATION's, re-read from the owner's words. */
export function documentCard(input: {
  docType: SmartbeeDocType
  lead: string
  /** The ID / company number that will be printed on the document, or null when none is sent. */
  customerIdNumber: string | null
  description: string
  amount: number
  vatOption: SmartbeeVatOption | null
  payment: ConfirmedPayment | null
  sandbox: boolean
}): string {
  const vat = input.vatOption === 'Include' ? ' כולל מע"מ' : input.vatOption === 'NotInclude' ? ' לפני מע"מ (SmartBee יוסיף מע"מ)' : ''
  return [
    `*להפיק ${DOC_TYPE_LABEL[input.docType]} ב-SmartBee?*`,
    input.sandbox ? '(סביבת בדיקות של SmartBee, לא מסמך אמיתי)' : null,
    `לקוח: ${name(input.lead)}`,
    input.customerIdNumber ? `ת.ז. / ח.פ. של הלקוח: ${input.customerIdNumber}` : 'ללא ת.ז. / ח.פ. של הלקוח',
    `תיאור: ${input.description}`,
    `סכום: ${ils(input.amount)}${vat}`,
    input.payment ? paymentLine(input.payment) : null,
    input.payment ? 'באישור את/ה מאשר/ת שהתשלום הזה התקבל בפועל.' : null,
    'המסמך יופק בחשבון ה-SmartBee של העסק. אחרי ההפקה הקישור לקובץ יישלח ללקוח בוואטסאפ (אם השיחה איתו פתוחה) או במייל.',
    'האישור בתוקף ל-15 דקות.',
  ]
    .filter(Boolean)
    .join('\n')
}

export function documentButtons(token: string): ReplyButton[] {
  return [
    { id: `wa:approve:${token}`, title: APPROVE_DOCUMENT_TITLE },
    { id: `wa:reject:${token}`, title: REJECT_TITLE },
  ]
}

/** After the tap, before SmartBee confirmed: never a success sentence. */
export const documentSubmittedReply = (docType: SmartbeeDocType) =>
  `הבקשה ל${DOC_TYPE_LABEL[docType]} נמסרה ל-SmartBee וממתינה לאישור שלהם. אשלח כאן את מספר המסמך והקישור ברגע ש-SmartBee יאשר שהמסמך הופק.`

export const documentRetryingReply = (docType: SmartbeeDocType) =>
  `עדיין לא קיבלתי אישור מ-SmartBee שהבקשה ל${DOC_TYPE_LABEL[docType]} התקבלה. אנסה שוב בלי ליצור מסמך כפול, ואעדכן כאן.`

/** What happened to the customer's copy, said plainly. A failure never suggests issuing again: the document exists. */
const CUSTOMER_DELIVERY_LINE: Readonly<Record<CustomerDelivery, string>> = {
  whatsapp: 'הקישור לקובץ נשלח ללקוח בוואטסאפ.',
  email: 'הקישור לקובץ נשלח ללקוח במייל.',
  whatsapp_unknown: 'לא ידוע אם הקישור הגיע ללקוח בוואטסאפ. כדאי לוודא איתו. המסמך עצמו הופק, אין צורך להפיק שוב.',
  no_channel: 'המסמך הופק, אבל לא נשלח ללקוח: השיחה איתו בוואטסאפ לא פתוחה ואין לו כתובת מייל תקינה. אפשר להעביר לו את הקישור שלמעלה. אין צורך להפיק שוב.',
  failed: 'המסמך הופק, אבל השליחה ללקוח נכשלה. אפשר להעביר לו את הקישור שלמעלה. אין צורך להפיק שוב.',
}

/** Built ONLY from a stored 102 result. */
export function documentCreatedNotice(input: { docType: SmartbeeDocType; number: string; amount: number; allocationNumber: string | null; link: string | null; customer: CustomerDelivery | null }): string {
  return [
    `*${DOC_TYPE_LABEL[input.docType]} הופקה ב-SmartBee*`,
    `מספר מסמך: ${input.number}`,
    `סכום: ${ils(input.amount)}`,
    input.allocationNumber ? `מספר הקצאה: ${input.allocationNumber}` : null,
    input.link ? `קובץ PDF: ${input.link}` : 'SmartBee לא החזיר קישור לקובץ. המסמך זמין בחשבון ה-SmartBee.',
    input.customer ? CUSTOMER_DELIVERY_LINE[input.customer] : 'המסמך לא נשלח ללקוח: SmartBee לא החזיר קישור לשליחה.',
  ]
    .filter(Boolean)
    .join('\n')
}

export function documentNotIssuedNotice(input: { docType: SmartbeeDocType; status: 'draft' | 'failed' | 'stalled'; reason: string | null }): string {
  const label = DOC_TYPE_LABEL[input.docType]
  if (input.status === 'draft') return `SmartBee שמר את ה${label} כטיוטה ולא כמסמך מופק. אפשר להשלים ולהפיק אותה בחשבון ה-SmartBee.`
  // The request MAY exist at SmartBee: never "not created", and never an invitation to simply ask again.
  if (input.status === 'stalled')
    return [
      `*לא ידוע אם ה${label} הופקה*`,
      'הבקשה נמסרה ל-SmartBee, אבל לא קיבלתי מהם אישור שהמסמך הופק או שלא הופק.',
      `יש לבדוק בחשבון ה-SmartBee אם ה${label} קיימת לפני שמבקשים מסמך נוסף, כדי שלא יופק מסמך כפול.`,
      RESOLVE_HOW,
    ].join('\n')
  const why =
    input.reason === 'api_plan_unavailable'
      ? 'החשבון ב-SmartBee לא כולל הפקה דרך API.'
      : input.reason === 'creation_disabled'
        ? 'הפקת מסמכים דרך החיבור הזה כבויה בהגדרות SmartBee.'
        : input.reason === 'owner_changed'
          ? 'בעל החשבון המחובר ל-SmartBee השתנה מאז האישור.'
          : input.reason === 'environment_changed'
            ? 'סביבת החיבור ל-SmartBee השתנתה מאז האישור.'
            : input.reason === 'invalid_provider_token' || input.reason === 'connection_unavailable' || input.reason === 'connection_inactive'
              ? 'החיבור ל-SmartBee אינו פעיל.'
              : 'SmartBee דחה את הפרטים.'
  // Only reached for a request that was never sent, or one SmartBee itself rejected.
  return `ה${label} לא הופקה. ${why} לא נוצר מסמך.`
}
