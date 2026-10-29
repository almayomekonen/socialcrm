/**
 * Lead BILLING tab — the document LIST only (`/clients/[clientId]/billing`).
 * The invoice editor and the documents themselves are Phase E / the billing
 * locale. Hebrew copied verbatim; states and kinds are labelled by CODE.
 * Invoice numbers and amounts are data.
 */
export const billing = {
  title: 'חיוב',
  create: 'צור מסמך',
  header: {
    document: 'מסמך',
    status: 'סטטוס',
    amount: 'סכום',
    issuedAt: 'תאריך הנפקה',
    dueAt: 'החזר עד',
  },
  edit: 'ערוך',
  view: 'הצג',
  empty: {
    title: 'אין חשבוניות לליד זה',
    canCreate: 'התחילו בהנפקת חשבונית ראשונה',
    noPermission: 'אין הרשאה להנפיק חשבוניות',
  },
  docState: { draft: 'טיוטה', issued: 'הונפקה', voided: 'בוטלה', replaced: 'הוחלפה' },
  fulfillState: { open: 'ממתינה לתשלום', partial: 'תשלום חלקי', paid: 'שולמה', overdue: 'באיחור', written_off: 'נמחקה' },
  draftNumber: 'טיוטה ללא מספר',
  identity: '{kind} {number}',
  kindShort: { invoice: 'חשבונית', invoice_receipt: 'חשבונית/קבלה' },
  picker: {
    label: 'בחירת סוג מסמך',
    title: 'איזה מסמך להפיק?',
    help: 'לא בטוחים מה סוג המסמך שאתם צריכים להוציא?',
    soon: 'בקרוב',
    kind: {
      invoice_receipt: 'חשבונית/קבלה',
      deal_invoice: 'חשבון עסקה',
      payment_request: 'דרישת תשלום',
      order: 'הזמנה (ספר הזמנות)',
      quote: 'הצעת מחיר',
      credit_note: 'מסמך זיכוי',
    },
  },
} as const
