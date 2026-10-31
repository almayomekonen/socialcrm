/**
 * The phone's desktop-only handoff screens (Phase F1): `MobileDesktopOnly` /
 * `MobileSectionHandoff` / `CopyDesktopLink`. Hebrew copied verbatim from
 * `lib/mobile/desktopOnlyRoutes.ts` (bodies are the full sentence, lead
 * sentence included) and `lib/activation/mobileHandoffCopy.ts` (the copy
 * action — the activation screens keep their own module, untouched). Section
 * titles that are the desktop's own word reuse `shell.nav.*`, `tasks.files.title`
 * and `performance.promotion.title`.
 */
export const desktopOnly = {
  title: {
    clients: 'לידים שסגרו עסקה',
    leadTasks: 'משימות הליד',
    leadFiles: 'קבצי הליד',
    leadBilling: 'חיוב הליד',
    aiInspector: 'AI Inspector',
  },
  body: {
    tasks: 'המסך הזה זמין כרגע מהמחשב. שם רואים את כל המשימות, מסננים לפי נציג ומסמנים מה כבר בוצע.',
    calendar: 'המסך הזה זמין כרגע מהמחשב. שם מחברים את יומן Google ורואים את כל הפגישות הקרובות.',
    deals: 'המסך הזה זמין כרגע מהמחשב. שם מנהלים את העסקאות ורואים את הסכומים וההתקדמות מולם.',
    clients: 'המסך הזה זמין כרגע מהמחשב. שם רואים את כל הלידים שכבר סגרו עסקה ואת מלוא הפרטים שלהם.',
    sumSales: 'המסך הזה זמין כרגע מהמחשב. שם רואים את סיכומי המכירות, היעדים והביצועים של כל נציג.',
    files: 'המסך הזה זמין כרגע מהמחשב. שם רואים את כל הקבצים שצורפו ללידים ולמשימות.',
    promotion: 'המסך הזה זמין כרגע מהמחשב. שם רואים את תחרויות המכירה, היעדים וההתקדמות שלך מולם.',
    leadTasks: 'המסך הזה זמין כרגע מהמחשב. שם רואים את כל המשימות שנפתחו לליד הזה ומוסיפים משימה חדשה.',
    leadFiles: 'המסך הזה זמין כרגע מהמחשב. שם רואים את הקבצים שצורפו לליד הזה ומצרפים קבצים מ-Google Drive.',
    leadBilling: 'המסך הזה זמין כרגע מהמחשב. שם מפיקים הצעות מחיר וחשבוניות לליד הזה ועוקבים אחרי הסטטוס שלהן.',
    aiInspector: 'המסך הזה זמין כרגע מהמחשב. שם רואים את היסטוריית ההחלטות של ה-AI ואת הנתונים שעליהם הן התבססו.',
  },
  /** The footer line; the address after it is not translated. */
  fullScreen: 'המסך המלא זמין במחשב',
  copy: {
    label: 'העתק קישור לכניסה מהמחשב',
    copied: 'הקישור הועתק',
    failed: 'לא הצלחנו להעתיק. אפשר לסמן את הכתובת ולהעתיק ידנית.',
  },
}
