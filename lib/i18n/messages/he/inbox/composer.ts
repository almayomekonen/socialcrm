/**
 * Inbox COMPOSER chrome (`/inbox`, desktop): the reply box, the emoji panel,
 * the 24-hour service-window states, the connection-health notices the
 * composer shows, and the locked state. Hebrew copied verbatim.
 *
 * `health.*` are the six WhatsApp notices of `lib/connections/messages.ts`
 * (`WHATSAPP_NOTICES`) that the composer can show. Settings keeps reading the
 * constants; a test pins both copies to the same Hebrew. The composer value
 * (what the rep types) is never touched by any of this.
 */
export const draft = {
  placeholder: 'כתוב טיוטה לתשובה...',
  label: 'טיוטת תשובה בוואטסאפ',
  emoji: 'הוספת אימוג׳י',
  aiTitle: 'נסח טיוטה עם AI',
  drafting: 'מנסח...',
  copy: 'העתק טיוטה',
  send: 'שלח הודעה',
  chars: '{count} / {max} תווים',
  draftFailed: 'לא ניתן היה לנסח טיוטה כרגע. נסה שוב.',
  copied: 'הטיוטה הועתקה',
  copyFailed: 'ההעתקה נכשלה',
  sent: 'ההודעה נשלחה — ממתין לאישור מסירה',
  sendFailed: 'שליחת ההודעה נכשלה',
  expired: 'חידוש המנוי מחזיר את ניסוח ושליחת ההודעות',
}

export const emoji = {
  loading: 'טוען אימוג׳ים…',
  dialog: 'בחירת אימוג׳י',
  search: 'חיפוש אימוג׳י',
}

export const serviceWindow = {
  closedTitle: 'חלון ההודעות ב-WhatsApp נסגר',
  closedBody: 'עברו יותר מ-24 שעות מאז ההודעה האחרונה של הלקוח. כדי להמשיך את השיחה, יש לשלוח הודעה מוכנה מאושרת.',
  closedCta: 'בחר הודעה מוכנה',
  closedNoTemplate: 'חלון ההודעות נסגר. כדי להמשיך את השיחה, נדרשת הודעה מוכנה מאושרת.',
  unknown: 'לא ניתן לשלוח הודעת טקסט. אין הודעה נכנסת מהלקוח בשיחה הזו.',
  templatesSettings: 'להודעות המוכנות',
  native: 'פתיחת השיחה בוואטסאפ',
}

export const connect = {
  /** Sentence before the link; the link text completes it. */
  lead: 'כדי לשלוח הודעות,',
  link: 'חברו את וואטסאפ',
  settings: 'להגדרות החיבור',
}

export const health = {
  reasonsLabel: 'בדרך כלל בגלל:',
  not_ready: {
    title: 'הגדרת מספר ה-WhatsApp עדיין לא הושלמה',
    explanation: 'עד להשלמת ההגדרה, SocialCRM לא יכול לקבל הודעות ולידים דרך החיבור הזה.',
    reason1: 'המספר טרם אומת',
    reason2: 'מוגדר קוד אימות דו-שלבי',
    nextStep: 'להשלים את האימות ב-WhatsApp Manager. אם מוגדר קוד דו-שלבי, יש להשביתו זמנית.',
  },
  restricted: {
    title: 'לא ניתן לשלוח הודעות כרגע',
    explanation: 'WhatsApp לא מאפשרת כרגע לשלוח הודעות מהחשבון המחובר.',
    nextStep: 'בדוק את חשבון WhatsApp המחובר ל-SocialCRM.',
  },
  expired: {
    title: 'החיבור לוואטסאפ פג',
    explanation: 'הודעות ולידים חדשים אינם נכנסים כרגע. כל המידע הקיים במערכת נשמר במלואו.',
    reason1: 'חלף זמן מהחיבור',
    reason2: 'ההרשאה ב-WhatsApp שונתה',
    nextStep: 'חידוש החיבור אורך פחות מדקה ואינו משפיע על נתונים קיימים.',
  },
  webhook: {
    title: 'החיבור ל-WhatsApp עדיין לא הושלם',
    explanation: 'לא הצלחנו לוודא שהודעות ולידים מגיעים ל-SocialCRM.',
    nextStep: 'כדאי להריץ את ההגדרה שוב ולהשלים את כל השלבים עד סגירת החלון.',
  },
  throttled: {
    title: 'החיבור תקין — בדיקת הסטטוס מוגבלת זמנית',
    explanation: 'מטא הגבילה זמנית את בדיקות הסטטוס. ההודעות והלידים ממשיכים לעבוד כרגיל.',
    nextStep: 'לא נדרשת פעולה כלשהי. נעדכן עם חזרת השירות.',
  },
  needs_verification: {
    title: 'צריך לאמת את חיבור ה-WhatsApp',
    explanation: 'החיבור קיים, אבל עדיין לא הצלחנו לוודא שהודעות ולידים נכנסים אליו. עד לאימות, ייתכן שהודעות לא יגיעו.',
    nextStep: 'כדאי לחבר מחדש כדי לוודא שהחיבור פעיל.',
  },
}

export const locked = {
  composer: 'חידוש המנוי מחזיר את שליחת ההודעות',
}
