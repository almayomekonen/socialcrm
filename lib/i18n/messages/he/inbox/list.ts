/**
 * Inbox LIST pane + page chrome (`/inbox`, desktop): tab title, toolbar
 * (smart sections, search, filters, sort), channel switch, conversation rows,
 * the empty workspace, and the labels of the persisted intelligence CODES.
 * Hebrew copied verbatim. Names, previews and phone numbers are data.
 */
export const page = {
  title: 'שיחות',
  /** The conversation pane's accessible name. */
  conversation: 'שיחה',
  unsupportedChannel: 'שיחות {channel} עדיין לא נתמכות כאן.',
  loading: 'טוען…',
}

export const toolbar = {
  status: {
    label: 'סטטוס',
    all: 'הכל',
    open: 'פתוחות',
    closed: 'סגורות',
    archived: 'בארכיון',
  },
  sort: {
    label: 'מיון',
    latest: 'פעילות אחרונה',
    oldest: 'פעילות ישנה',
    unread: 'לא נקראו תחילה',
    temperature: 'לידים חמים תחילה',
    intent: 'לפי כוונת הליד',
    action: 'לפי צעד מומלץ',
  },
  intel: {
    label: 'סינון חכם',
    all: 'כל השיחות',
    hot: 'לידים חמים',
    attention: 'דורש טיפול מיידי',
    pricing: 'בקשות מחיר',
    demo: 'בקשות הדגמה',
    support: 'פניות שירות',
    escalation: 'אסקלציות שירות',
    followup: 'דרוש המשך טיפול',
  },
  smart: {
    hot: 'שיחות חמות',
    attention: 'דורש טיפול מיידי',
    demo: 'הזדמנויות הדגמה',
    escalation: 'אסקלציות שירות',
  },
  searchPlaceholder: 'חיפוש שם, טלפון או הודעה',
  searchLabel: 'חיפוש שיחות',
  unread: 'לא נקראו',
  needsReply: 'ממתינות למענה',
}

export const channels = {
  label: 'ערוץ',
  whatsapp: 'שיחות',
  facebook: 'תגובות',
  messengerUnread: { other: '{count} שיחות שלא נקראו' },
}

export const list = {
  empty: 'לא נמצאו שיחות',
  loadMore: 'טען עוד',
  loadingMore: 'טוען...',
}

export const row = {
  fallbackName: 'שיחה',
  /** Avatar initial when there is no name (the first letter of "ליד"). */
  avatarFallback: 'ל',
  sentPrefix: 'נשלח:',
  nextStep: 'הצעד הבא: {action}',
  unread: 'לא נקרא',
}

export const empty = {
  pickTitle: 'בחר שיחה מהרשימה כדי להתחיל',
  pickBody: 'ההודעות, הניתוח והצעד הבא המומלץ יופיעו כאן.',
  noneTitle: 'אין שיחות WhatsApp עדיין',
  noneBody: 'כשליד יכתוב בוואטסאפ, השיחה תופיע כאן אוטומטית.',
}

/** Labels of the persisted conversation-intelligence CODES (display only). */
export const intel = {
  intent: {
    pricing: 'מתעניין במחיר',
    demo: 'מבקש הדגמה',
    signup: 'רוצה להצטרף',
    support: 'בקשת שירות',
    followup: 'המשך טיפול',
    information: 'מבקש מידע',
  },
  temperature: {
    hot: 'ליד חם',
    warm: 'ליד פושר',
    cold: 'ליד קר',
  },
  action: {
    send_quote: 'שלח הצעת מחיר',
    schedule_demo: 'קבע הדגמה',
    follow_up: 'שלח הודעת המשך',
    answer_question: 'ענה לשאלת הליד',
    close_lead: 'התקדם לסגירה',
    escalate_support: 'העבר לטיפול שירות',
  },
  confidence: {
    high: 'ביטחון גבוה',
    medium: 'ביטחון בינוני',
    low: 'ביטחון נמוך',
  },
}
