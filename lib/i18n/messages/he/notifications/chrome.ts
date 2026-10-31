/**
 * The notification surfaces' own chrome (Phase F3): the bell's panel, the
 * center (desktop + phone), its filters, the phone selection bar, the arrival
 * toast. Hebrew copied byte-for-byte from the components and from
 * `CATEGORY_LABEL` (modules/notifications/dropdown.ts), which stays the
 * registry of record — `notificationsCopyPin.test.ts` holds them equal.
 */

export const category = {
  leads: 'לידים',
  messages: 'שיחות',
  followups: 'מעקבים',
  sla: 'זמני תגובה',
  integrations: 'חיבורים',
} as const

export const panel = {
  markAll: 'סימון הכל כנקרא',
  viewAll: 'כל ההתראות',
  away: {
    title: 'בזמן שלא היית',
    count: { one: 'התראה אחת חדשה', other: '{count} התראות חדשות' },
    /** One category in the away line: its label and its count. */
    category: '{label} {count}',
    separator: ', ',
  },
  empty: {
    title: 'אין התראות חדשות',
    body: 'כשליד חדש ייכנס או כשמשהו ידרוש טיפול, זה יופיע כאן.',
  },
} as const

export const center = {
  empty: {
    title: 'אין התראות',
    filteredTitle: 'אין התראות שתואמות לסינון',
    filteredBody: 'אפשר להסיר את הסינון ולראות את כל ההתראות.',
  },
  loadMore: 'הצג עוד',
  loadFailed: 'לא הצלחנו לטעון — נסה שוב',
} as const

export const filters = {
  readState: 'מצב קריאה',
  category: 'קטגוריה',
  all: 'הכל',
  unread: 'לא נקראו',
  allTypes: 'כל הסוגים',
  /** The phone's one segmented control. */
  mobileLabel: 'סינון התראות',
} as const

export const toast = {
  /** Several arrivals in one poll: one summary toast (always two or more). */
  many: { one: '{count} התראות חדשות', other: '{count} התראות חדשות' },
} as const
