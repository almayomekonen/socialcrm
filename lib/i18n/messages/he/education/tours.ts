/**
 * Product tour steps (Phase E6), copied byte-for-byte from
 * `lib/education/registry.ts`, keyed by tour and by the step's target
 * (`end` = the closing step without a target). The registry stays the source
 * of what each tour shows and in what order; `lib/education/tourCopy.ts`
 * words its steps from here outside Hebrew (`educationCopyPin.test.ts` pins
 * catalog = registry). "מעקב" in the lead tour is the FOLLOW-UP control.
 */
export const tours = {
  overview: {
    today: { title: 'היום', description: 'כאן רואים מה דורש תשומת לב עכשיו.' },
    leads: { title: 'לידים', description: 'כל הלידים שלך, מכל הערוצים, במקום אחד.' },
    clients: { title: 'לקוחות', description: 'לידים שנסגרו — ממשיכים לנהל אותם מכאן.' },
    inbox: { title: 'שיחות', description: 'כאן מנהלים את השיחות עם הלידים.' },
    deals: { title: 'עסקאות', description: 'כאן עוקבים אחרי עסקאות שבתהליך.' },
    performance: { title: 'ביצועים', description: 'כאן רואים איך העבודה מתקדמת.' },
    tasks: { title: 'משימות', description: 'כאן רואים מה צריך לסגור.' },
    calendar: { title: 'פגישות', description: 'כאן רואים את הפגישות הקרובות.' },
    settings: { title: 'הגדרות', description: 'כאן מחברים וואטסאפ, פייסבוק והגדרות נוספות.' },
    header: { title: 'הסרגל העליון', description: 'כאן נמצאים הפעולות והכלים שזמינים לך מכל מקום במערכת.' },
    copilot: {
      title: 'העוזר החכם',
      description: 'צריך עזרה? שאל את העוזר החכם והוא יעזור לך להבין מה לעשות ואיך להתקדם.',
    },
    notifications: { title: 'התראות', description: 'כאן תראה דברים שדורשים את תשומת הלב שלך.' },
    end: { title: 'זהו, עכשיו אתה בעניינים', description: 'הכרת את האזורים המרכזיים של SocialCRM. מכאן אפשר להתחיל לעבוד.' },
  },
  pipeline: {
    table: { title: 'הרשימה', description: 'כאן נמצאים כל הלידים שלך, מכל הערוצים, ומכאן מתחילה העבודה היומיומית.' },
    statuses: { title: 'סטטוסים', description: 'הסטטוס עוזר לך לדעת מי חדש, מי בטיפול ומי צריך את תשומת הלב שלך.' },
    open: {
      title: 'פתיחת ליד',
      description: 'מצאת ליד לעבוד עליו? פתח אותו כדי לראות את הפרטים, ליצור קשר ולעדכן את הפעולה הבאה.',
    },
    add: { title: 'ליד חדש', description: 'אפשר להוסיף לידים ידנית, לייבא אותם או לקבל אותם מהערוצים שמחוברים ל־SocialCRM.' },
    end: { title: 'זה כל הרעיון', description: 'מצא ליד → פתח אותו → עבוד עליו → המשך לליד הבא.' },
  },
  lead: {
    status: { title: 'סטטוס הליד', description: 'מעדכנים אחרי שיחה כדי ששום דבר לא ייפול.' },
    followUp: { title: 'מעקב', description: 'קובעים מתי לחזור — המערכת מזכירה בזמן.' },
  },
  copilot: {
    trigger: { title: 'העוזר החכם', description: 'שואלים מי צריך אתכם עכשיו. לא שולח הודעות בלי אישור.' },
  },
  whatsapp: {
    section: { title: 'וואטסאפ', description: 'מחברים וואטסאפ כאן, בהגדרות ← אינטגרציות.' },
    connect: { title: 'חיבור', description: 'מתחילים את חיבור הוואטסאפ מהכפתור הזה.' },
  },
  facebook: {
    section: { title: 'פייסבוק', description: 'מחברים פייסבוק כאן, בהגדרות ← אינטגרציות.' },
    connect: { title: 'חיבור', description: 'מתחילים את חיבור הפייסבוק מהכפתור הזה.' },
  },
} as const
