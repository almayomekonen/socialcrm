/**
 * Shared defaults used across the product. The Hebrew values are the exact
 * strings `Btn` and `lib/toast.tsx` rendered before i18n (asserted in
 * __tests__/i18n/sharedDefaults.test.tsx).
 */
export const common = {
  /** Lead-source channel labels (lib/leads/leadSourceLabel.ts). Brand names stay in Latin script where the brand does. */
  source: { whatsapp: 'WhatsApp', facebook: 'Facebook', instagram: 'Instagram', website: 'אתר', manual: 'ידני' },
  /** Shared primitives (Phase C): dialog chrome, pickers, the generic table. Text only — direction stays per region. */
  dialog: { close: 'סגירה', closeTitle: 'יציאה ללא שמירה', fallbackName: 'תיבת דו-שיח', confirm: 'אישור', cancel: 'ביטול' },
  /** Shared mobile sheets (`components/mobile/*`, opt-in `translated`). */
  sheet: { working: 'מבצע...', selected: { other: 'נבחרו {count}' } },
  picker: { search: 'חיפוש...', selectAll: 'בחר הכל', clearAll: 'הסר הכל' },
  table: {
    columns: 'עמודות לצפיה',
    freeSearch: '🔎︎  חיפוש חופשי...',
    records: { other: '{count} רשומות' },
    recordsOf: { other: '{count} רשומות מתוך {total}' },
    prev: 'הקודם',
    next: 'הבא',
    exportPdf: 'ייצוא טבלה ל PDF',
    exportExcel: 'ייצוא טבלה ל Excel',
    pdfTitle: 'כותרת',
    pdfImage: 'העלאת תמונה',
    pdfSumRow: 'הוספת שורת סה"כ בסוף הטבלה',
    pdfCreate: 'יצירת מסמך PDF',
  },
  save: 'שמירה',
  toast: {
    success: 'בוצע בהצלחה!',
    error: 'אירעה שגיאה!',
    loading: 'טוען...',
    ban: 'אינך מורשה',
    message: 'הודעה חדשה',
    pro: 'הפעולה זמינה עם Pro',
    /** The Pro toast's default call-to-action (`lib/toast.tsx`). */
    proCta: 'חידוש מנוי',
  },
  /** `useAction`'s generic failure line (Phase E6; `lib/useAction.ts`). */
  actionFailed: 'משהו השתבש, נסה שוב',
  /** The (app) segment error boundary (`app/(app)/error.tsx`). */
  appError: {
    title: 'חלה שגיאה במערכת',
    body: 'משהו השתבש בטעינת המסך. אפשר לנסות שוב, או לחזור לרשימת הלידים.',
    retry: 'נסה שנית',
    back: 'חזרה ללידים',
  },
} as const
