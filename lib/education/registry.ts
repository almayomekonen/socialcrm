import {
  HEADER_EDU,
  LEAD_OPEN_EDU,
  NOTIFICATIONS_EDU,
  eduSel,
  type TourDefinition,
  type TourId,
  type TourStep,
} from './types'

const NAV_POPOVER = { side: 'left' as const, align: 'start' as const }

/** Explicit top-to-bottom sidebar order. Do not derive this from object key order. */
const OVERVIEW_NAV_STEPS: TourStep[] = [
  {
    element: eduSel('nav-today'),
    title: 'היום',
    description: 'כאן רואים מה דורש תשומת לב עכשיו.',
    ...NAV_POPOVER,
  },
  {
    element: eduSel('nav-leads'),
    title: 'לידים',
    description: 'כל הלידים שלך, מכל הערוצים, במקום אחד.',
    ...NAV_POPOVER,
  },
  {
    element: eduSel('nav-clients'),
    title: 'לקוחות',
    description: 'לידים שנסגרו — ממשיכים לנהל אותם מכאן.',
    ...NAV_POPOVER,
  },
  {
    element: eduSel('nav-inbox'),
    title: 'שיחות',
    description: 'כאן מנהלים את השיחות עם הלידים.',
    ...NAV_POPOVER,
  },
  {
    element: eduSel('nav-deals'),
    title: 'עסקאות',
    description: 'כאן עוקבים אחרי עסקאות שבתהליך.',
    ...NAV_POPOVER,
  },
  {
    element: eduSel('nav-performance'),
    title: 'ביצועים',
    description: 'כאן רואים איך העבודה מתקדמת.',
    ...NAV_POPOVER,
  },
  {
    element: eduSel('nav-tasks'),
    title: 'משימות',
    description: 'כאן רואים מה צריך לסגור.',
    ...NAV_POPOVER,
  },
  {
    element: eduSel('nav-calendar'),
    title: 'פגישות',
    description: 'כאן רואים את הפגישות הקרובות.',
    ...NAV_POPOVER,
  },
  {
    element: eduSel('nav-settings'),
    title: 'הגדרות',
    description: 'כאן מחברים וואטסאפ, פייסבוק והגדרות נוספות.',
    ...NAV_POPOVER,
  },
]

const TOURS: TourDefinition[] = [
  {
    id: 'overview',
    version: 3,
    auto: false,
    steps: [
      ...OVERVIEW_NAV_STEPS,
      {
        element: eduSel(HEADER_EDU),
        title: 'הסרגל העליון',
        description: 'כאן נמצאים הפעולות והכלים שזמינים לך מכל מקום במערכת.',
        side: 'bottom',
        align: 'center',
      },
      {
        element: eduSel('copilot-trigger'),
        title: 'העוזר החכם',
        description: 'צריך עזרה? שאל את העוזר החכם והוא יעזור לך להבין מה לעשות ואיך להתקדם.',
        side: 'bottom',
        align: 'end',
      },
      {
        element: eduSel(NOTIFICATIONS_EDU),
        title: 'התראות',
        description: 'כאן תראה דברים שדורשים את תשומת הלב שלך.',
        side: 'bottom',
        align: 'end',
      },
      {
        title: 'זהו, עכשיו אתה בעניינים',
        description: 'הכרת את האזורים המרכזיים של SocialCRM. מכאן אפשר להתחיל לעבוד.',
      },
    ],
  },
  {
    id: 'pipeline',
    version: 2,
    auto: true,
    steps: [
      {
        element: eduSel('leads-table'),
        title: 'הרשימה',
        description: 'כאן נמצאים כל הלידים שלך, מכל הערוצים, ומכאן מתחילה העבודה היומיומית.',
        side: 'top',
        align: 'center',
      },
      {
        element: eduSel('lead-status-tabs'),
        title: 'סטטוסים',
        description: 'הסטטוס עוזר לך לדעת מי חדש, מי בטיפול ומי צריך את תשומת הלב שלך.',
        side: 'bottom',
        align: 'start',
      },
      {
        element: eduSel(LEAD_OPEN_EDU),
        title: 'פתיחת ליד',
        description: 'מצאת ליד לעבוד עליו? פתח אותו כדי לראות את הפרטים, ליצור קשר ולעדכן את הפעולה הבאה.',
        side: 'bottom',
        align: 'start',
      },
      {
        element: eduSel('leads-add'),
        title: 'ליד חדש',
        description: 'אפשר להוסיף לידים ידנית, לייבא אותם או לקבל אותם מהערוצים שמחוברים ל־SocialCRM.',
        side: 'bottom',
        align: 'end',
      },
      {
        title: 'זה כל הרעיון',
        description: 'מצא ליד → פתח אותו → עבוד עליו → המשך לליד הבא.',
      },
    ],
  },
  {
    id: 'lead',
    version: 1,
    auto: true,
    blockedByFirstLead: true,
    steps: [
      {
        element: eduSel('lead-status'),
        title: 'סטטוס הליד',
        description: 'מעדכנים אחרי שיחה כדי ששום דבר לא ייפול.',
        side: 'bottom',
        align: 'start',
      },
      {
        element: eduSel('lead-followup'),
        title: 'מעקב',
        description: 'קובעים מתי לחזור — המערכת מזכירה בזמן.',
        side: 'bottom',
        align: 'end',
      },
    ],
  },
  {
    id: 'copilot',
    version: 1,
    auto: true,
    requiresCopilot: true,
    steps: [
      {
        element: eduSel('copilot-trigger'),
        title: 'העוזר החכם',
        description: 'שואלים מי צריך אתכם עכשיו. לא שולח הודעות בלי אישור.',
        side: 'bottom',
        align: 'end',
      },
    ],
  },
  {
    id: 'whatsapp',
    version: 1,
    auto: false,
    steps: [
      {
        element: eduSel('whatsapp-section'),
        title: 'וואטסאפ',
        description: 'מחברים וואטסאפ כאן, בהגדרות ← אינטגרציות.',
        side: 'left',
        align: 'start',
      },
      {
        element: eduSel('whatsapp-connect'),
        title: 'חיבור',
        description: 'מתחילים את חיבור הוואטסאפ מהכפתור הזה.',
        side: 'bottom',
        align: 'start',
      },
    ],
  },
  {
    id: 'facebook',
    version: 1,
    auto: false,
    steps: [
      {
        element: eduSel('facebook-section'),
        title: 'פייסבוק',
        description: 'מחברים פייסבוק כאן, בהגדרות ← אינטגרציות.',
        side: 'left',
        align: 'start',
      },
      {
        element: eduSel('facebook-connect'),
        title: 'חיבור',
        description: 'מתחילים את חיבור הפייסבוק מהכפתור הזה.',
        side: 'bottom',
        align: 'start',
      },
    ],
  },
]

const BY_ID = new Map(TOURS.map((t) => [t.id, t]))

export function getTour(id: TourId): TourDefinition | undefined {
  return BY_ID.get(id)
}

export function isTourId(value: string | null | undefined): value is TourId {
  return !!value && BY_ID.has(value as TourId)
}

export function allTours(): TourDefinition[] {
  return TOURS
}
