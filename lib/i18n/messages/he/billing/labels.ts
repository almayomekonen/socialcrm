/**
 * Billing labels keyed by CODE (Phase E3), for the screens only: payment
 * methods (`bill_invoices.paymentMethod*`), issue / save failure reasons.
 * Hebrew is exactly what `PAYMENT_METHOD_OPTIONS` and `issueErrorMessage`
 * return; those producers are unchanged and still feed the PDF.
 */
export const paymentMethod = {
  cash: 'מזומן',
  bank_transfer: 'העברה בנקאית',
  credit_card: 'כרטיס אשראי',
  check: 'שיק',
  digital: 'אמצעי דיגיטלי',
  other_method: 'אחר',
} as const

export const issueError = {
  payment_exceeds_total: 'הסכום שהתקבל לא יכול להיות גבוה מסכום המסמך',
  payment_incomplete: 'יש להשלים את פרטי התשלום',
  issuer_identity_incomplete: 'יש להשלים את פרטי העסק',
  no_permission: 'אין הרשאה להנפיק',
  lead_not_found: 'הליד לא נמצא',
  invoice_not_found: 'החשבונית לא נמצאה',
  not_draft: 'החשבונית כבר הונפקה',
  empty_lines: 'יש להוסיף לפחות פריט אחד',
  profile_archived: 'פרופיל החיוב לא פעיל',
  empty_legal_name: 'יש להזין שם לחיוב',
  zero_total: 'סכום המסמך חייב להיות גדול מאפס',
  line_not_found: 'אחד הפריטים לא נמצא',
  invalid_input: 'נתונים לא תקינים',
  failed: 'הנפקת החשבונית נכשלה',
} as const

/** The shared lead picker (`components/billing/lead-picker`; billing, the meeting dialog, Messenger). */
export const picker = {
  trigger: 'בחר לקוח/ה',
  search: 'חיפוש לקוח/ה...',
  none: 'אין תוצאות',
  billed: 'כבר חויבו',
  recent: 'לידים אחרונים',
  create: 'יצירת לקוח/ה חדש/ה',
  noName: 'ללא שם',
  invoices: { other: '{count} חשבוניות' },
  current: 'נוכחי',
} as const
