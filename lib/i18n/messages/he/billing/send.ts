/**
 * The send-document dialog's chrome (Phase E3). Hebrew copied verbatim. The
 * e-mail itself (subject, body, the PDF link) is sent by the server in the
 * billing language and is not worded here; the personal message is the user's.
 */
export const send = {
  title: 'שליחת חשבונית',
  kind: { invoice: 'שליחת חשבונית', invoice_receipt: 'שליחת חשבונית/קבלה' },
  intro: 'ללקוח יישלח מייל עם קישור להורדת המסמך כקובץ PDF.',
  recipient: 'לאיזה מייל לשלוח',
  showAdvanced: 'אפשרויות נוספות',
  hideAdvanced: 'הסתר אפשרויות נוספות',
  message: 'הודעה אישית (אופציונלי)',
  messagePlaceholder: 'שלום, מצורפת החשבונית. תודה!',
  submit: 'שלח חשבונית',
  invalidEmail: 'הזן כתובת מייל תקינה',
  expired: 'חידוש המנוי מחזיר את שליחת החשבוניות.',
  sent: 'החשבונית נשלחה',
  error: {
    no_permission: 'אין הרשאה לשליחת חשבוניות',
    lead_not_found: 'הליד לא נמצא',
    invoice_not_found: 'החשבונית לא נמצאה',
    invoice_not_issued: 'החשבונית עדיין טיוטה',
    pdf_not_ready: 'קובץ ה-PDF עדיין לא מוכן',
    invalid_email: 'כתובת המייל אינה תקינה',
    rate_limited: 'נשלחה בקשה לאחרונה — נסו שוב בעוד מספר שניות',
    transport_failed: 'שירות המייל סירב — בדקו את הלוגים',
    failed: 'שליחת החשבונית נכשלה',
  },
} as const
