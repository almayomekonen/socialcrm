/**
 * The support centre's chrome (i18n Phase F5): shell, landing, request list,
 * the new-request form, the thread and its reply box, the guides pages.
 * Hebrew copied verbatim from `app/(support)/**`, `components/support/*` and
 * `lib/support/copy.ts` (`STATUS_COPY`, `CATEGORY_COPY`, `KIND_COPY`,
 * `AUTHOR_LABEL`, the error map — pinned in supportCopyPin.test.ts). Status,
 * category, kind and error are keyed by their CODE; a request's subject and
 * every message body are the customer's / our team's words and never pass here.
 */
export const shell = {
  back: 'חזרה למערכת',
  /** `GENERIC_DISPLAY_NAME`, shown when the user has no name at all. */
  genericName: 'משתמש',
}

export const center = {
  title: 'מרכז התמיכה',
  intro: 'משהו לא עובד כמו שצריך? אנחנו כאן כדי לעזור.',
  mine: 'הפניות שלי',
  all: 'כל הפניות',
  guides: 'מדריכים',
  guidesDescription: 'איך להשתמש ב-SocialCRM',
}

export const kind = {
  problem: { tileTitle: 'יש לי תקלה', tileDescription: 'משהו ב-SocialCRM לא עובד', formTitle: 'מה קרה?' },
  question: { tileTitle: 'יש לי שאלה', tileDescription: 'עזרה בשימוש במערכת', formTitle: 'מה השאלה?' },
}

export const requests = {
  intro: 'השיחות שלך עם צוות SocialCRM.',
  emptyTitle: 'עדיין לא פנית אלינו',
  emptyBody: 'אם משהו לא עובד כמו שצריך, ספרו לנו ואנחנו נטפל בזה.',
}

export const newRequest = {
  title: 'פנייה חדשה',
  intro: 'נחזור אליך כאן במרכז התמיכה וגם באימייל.',
}

export const form = {
  addMore: 'רוצה להוסיף משהו?',
  addMorePlaceholder: 'רוצה להוסיף משהו? (לא חובה)',
  placeholder: 'ספר לנו בקצרה מה קרה...',
  sending: 'שולח…',
  send: 'שליחת הפנייה',
  sent: 'הפנייה נשלחה. נחזור אליך בהקדם.',
}

export const reply = {
  label: 'מענה',
  reopens: 'מענה יפתח את הפנייה מחדש.',
  placeholder: 'כתבו כאן…',
  send: 'שליחת מענה',
}

export const status = {
  open: 'נפתחה',
  in_progress: 'בטיפול',
  waiting_for_customer: 'ממתינה לתשובתך',
  resolved: 'נסגרה',
}

export const category = {
  leads: 'לידים',
  whatsapp: 'WhatsApp',
  meta: 'Facebook ו-Instagram',
  automations: 'אוטומציות',
  ai: 'עוזר חכם',
  billing: 'מנוי ותשלום',
  account: 'חשבון והגדרות',
  integrations: 'אינטגרציות',
  otherTopic: 'אחר',
}

export const author = {
  self: 'את/ה',
  support: 'צוות SocialCRM',
}

export const error = {
  forbidden: 'אין לך הרשאה לפעולה הזו',
  not_found: 'הפנייה לא נמצאה',
  invalid_subject: 'צריך לכתוב נושא קצר לפנייה',
  invalid_body: 'צריך לכתוב מה קרה',
  invalid_category: 'צריך לבחור נושא מהרשימה',
  rate_limited: 'נשלחו הרבה פניות בזמן קצר. אפשר לנסות שוב בעוד שעה.',
  fallback: 'הפעולה נכשלה. נסו שוב.',
}

export const search = {
  label: 'מחפש הסבר?',
  placeholder: 'חיפוש במדריכים…',
  searching: 'מחפש…',
}

export const guides = {
  intro: 'הסברים קצרים לפי נושא.',
  emptyTitle: 'לא נמצאו מדריכים',
  emptyBody: 'אפשר לספר לנו מה קרה ואנחנו נעזור.',
  notFound: 'לא מצאתם מה שחיפשתם?',
  notSolved: 'זה לא פתר את הבעיה?',
  tellUs: 'ספרו לנו מה קרה',
}
