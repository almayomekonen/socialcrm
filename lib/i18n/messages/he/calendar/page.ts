/**
 * `/calendar` page, grid and gesture feedback (Phase E1). Hebrew copied
 * verbatim from the page, `CalendarView`, its hooks and `rescheduleFeedback`.
 * "Google", "Google Meet", "Meet", "CRM" and "Pro" are product names. Meeting
 * titles, attendee e-mails and Google's sync-error text are data.
 */
export const page = {
  title: 'פגישות',
  heading: 'פגישות',
  newMeeting: 'פגישה חדשה',
  loading: 'טוען יומן…',
  notConnected: {
    title: 'חבר את היומן שלך',
    body: 'חבר את חשבון Google שלך כדי לנהל פגישות עם לידים, ליצור קישורי Meet אוטומטית ולסנכרן ליומן Google.',
    cta: 'לחיבור היומן',
  },
  reauth: {
    title: 'החיבור ליומן Google פג',
    body: 'פגישות חדשות לא יסונכרנו עד החיבור מחדש.',
    cta: 'חבר מחדש',
  },
  /** FullCalendar toolbar buttons (the rest of the grid's text comes from its own locale pack). */
  grid: { today: 'היום', month: 'חודש', week: 'שבוע', day: 'יום' },
} as const

/** Pro prompts: the paid actions on the page, answered after a subscription lapses. */
export const pro = {
  create: { title: 'יצירת פגישות זמינה עם Pro', body: 'חידוש המנוי יחזיר את האפשרות לקבוע פגישות.' },
  move: { title: 'עריכת פגישות זמינה עם Pro', body: 'חידוש המנוי יחזיר את האפשרות לערוך פגישות.' },
  retry: { title: 'סנכרון יומן זמין עם Pro', body: 'חידוש המנוי יחזיר את הסנכרון ליומן Google.' },
  cancel: { title: 'ביטול פגישות זמין עם Pro', body: 'חידוש המנוי יחזיר את האפשרות לבטל פגישות.' },
  outcome: { title: 'עדכון תוצאת פגישה זמין עם Pro', body: 'חידוש המנוי יחזיר את האפשרות לעדכן תוצאות.' },
} as const

/** Drag (`move`) and resize feedback, keyed by the gesture and `updateMeeting`'s result code. */
export const reschedule = {
  moveMarked: 'לא ניתן להזיז פגישה שכבר סומנה',
  movePast: 'לא ניתן להזיז פגישה לתאריך שעבר',
  resizeMarked: 'לא ניתן לשנות משך פגישה שכבר סומנה',
  tooShort: 'משך הפגישה חייב להיות לפחות 5 דקות',
  busy: 'פגישה אחרת בעיצומה של עדכון. נסה שוב בעוד רגע.',
  invalidTimes: 'הזמנים שהוזנו אינם תקינים',
  move: {
    synced: 'הפגישה הועברה וסונכרנה ליומן Google',
    notSynced: 'הפגישה הועברה ב-CRM (לא מסונכרנת ליומן Google)',
    reauth: 'הפגישה הועברה ב-CRM. נדרש חיבור מחדש ליומן Google.',
    syncFailed: 'הפגישה הועברה ב-CRM. סנכרון ליומן Google נכשל.',
    conflict: 'הפגישה הועברה ב-CRM. סנכרון ליומן Google נכשל (נדרש רענון).',
    notOwner: 'אינך מורשה להעביר פגישה זו',
    failed: 'העברת הפגישה נכשלה',
  },
  resize: {
    synced: 'משך הפגישה עודכן וסונכרן ליומן Google',
    notSynced: 'משך הפגישה עודכן ב-CRM (לא מסונכרנת ליומן Google)',
    reauth: 'משך הפגישה עודכן ב-CRM. נדרש חיבור מחדש ליומן Google.',
    syncFailed: 'משך הפגישה עודכן ב-CRM. סנכרון ליומן Google נכשל.',
    conflict: 'משך הפגישה עודכן ב-CRM. סנכרון ליומן Google נכשל (נדרש רענון).',
    notOwner: 'אינך מורשה לעדכן פגישה זו',
    failed: 'עדכון משך הפגישה נכשל',
  },
} as const

/** Retry-sync and cancel results (details dialog, handled by the view). */
export const sync = {
  retried: 'הפגישה סונכרנה',
  retryReauth: 'נדרש חיבור מחדש ליומן',
  retryFailed: 'הסנכרון נכשל',
  cancelled: 'הפגישה בוטלה',
  cancelReauth: 'הפגישה בוטלה ב-CRM. נדרש חיבור מחדש ליומן.',
  cancelGoogleFailed: 'הפגישה בוטלה ב-CRM. מחיקה ביומן Google נכשלה.',
  cancelFailed: 'ביטול הפגישה נכשל',
} as const
