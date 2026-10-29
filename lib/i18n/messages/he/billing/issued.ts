/**
 * The ISSUED document's screen chrome (Phase E3): the view around an issued /
 * voided / replaced document, its timeline, the live PDF status, the post-issue
 * banner, the hero actions and the send dialog. Hebrew copied verbatim. The PDF
 * and every snapshot printed on it are the legal document (BILLING locale) and
 * are never worded from here.
 */
export const issued = {
  noName: 'ללא שם',
  issuedOn: 'הונפקה ב-{date}',
  recipientSigned: 'לכבוד (חתום במסמך)',
  rounding: 'עיגול',
  outstanding: 'יתרה לתשלום',
  paymentSigned: 'פרטי תשלום שהתקבל (חתום במסמך)',
  paymentAmount: 'סכום',
  customerNote: 'הערה ללקוח',
  activity: 'פעילות',
  loadingHistory: 'טוען היסטוריה…',
  notFound: 'החשבונית לא נמצאה',
  backToList: 'חזרה לרשימת החשבוניות',
  timeline: {
    empty: 'אין פעילות מתועדת עדיין',
    drafted: 'נוצרה טיוטה',
    updated: 'הטיוטה עודכנה',
    issued: 'הונפק',
    issuedIdentity: 'הונפק {identity}',
    issuedTotal: 'הונפק · סכום {amount}',
    issuedIdentityTotal: 'הונפק {identity} · סכום {amount}',
    voided: 'המסמך בוטל',
    replaced: 'המסמך הוחלף',
    payment: 'התקבל תשלום',
    paymentAmount: 'התקבל תשלום · {amount}',
    paymentMethod: 'התקבל תשלום באמצעות {method}',
    paymentAmountMethod: 'התקבל תשלום · {amount} באמצעות {method}',
  },
  pdf: {
    none: 'PDF בקרוב',
    not_applicable: 'אין מסמך',
    scheduled: 'PDF בקרוב',
    rendering: 'מופק כעת',
    ready: 'מסמך זמין',
    failed: 'שגיאה בהפקה',
    errorReason: '· שגיאת הפקה: {reason}',
  },
  banner: {
    ready: { invoice: 'החשבונית מוכנה', invoice_receipt: 'חשבונית/קבלה מוכנה' },
    rendering: { invoice: 'מפיק את החשבונית…', invoice_receipt: 'מפיק את החשבונית/קבלה…' },
    failed: 'הפקת ה-PDF נכשלה',
    failedHint: 'אפשר לנסות להפיק שוב מתפריט הפעולות.',
    renderingHint: 'ברגע שהמסמך יהיה מוכן אפשר יהיה לשלוח אותו.',
    readyHint: 'לשלוח ללקוח עכשיו?',
    send: { invoice: 'שלח חשבונית', invoice_receipt: 'שלח חשבונית/קבלה' },
    later: 'מאוחר יותר',
  },
  pendingTitle: 'המסמך עדיין מופק…',
  failedTitle: 'יש לנסות להפיק את ה-PDF מחדש',
  download: 'הורד PDF',
  rendering: 'מופק כעת…',
  retry: 'נסה שוב',
  rerender: 'הפק PDF מחדש',
  duplicateHero: 'צור חשבונית חדשה מבוססת על זו',
  duplicate: 'שכפל לטיוטה חדשה',
  toast: {
    duplicated: 'נוצרה טיוטה חדשה',
    duplicateFailed: 'שכפול החשבונית נכשל',
    rerenderSent: 'בקשת הפקה נשלחה',
    rerenderFailed: 'בקשת ההפקה נכשלה',
  },
} as const
