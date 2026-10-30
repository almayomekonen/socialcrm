/**
 * Tour chrome (Phase E6): the Driver.js buttons and progress line, the
 * first-time Help spotlight, the Help menu and the "no leads yet" notice.
 * Hebrew copied verbatim from `components/education/*`. `{current}` /
 * `{total}` are Driver.js's own counters (passed through as `{{current}}`).
 */
export const chrome = {
  progress: '{current} מתוך {total}',
  next: 'הבא',
  prev: 'חזרה',
  done: 'הבנתי',
  skip: 'דלג',
  fallbackLabel: 'סיור מודרך',
} as const

export const intro = {
  title: 'ברוכים הבאים ל־SocialCRM',
  description: 'רוצה סיור קצר במערכת?',
  start: 'התחל סיור',
  later: 'אולי אחר כך',
} as const

/** The menu's title is `shell.help` (the same word as the button that opens it). */
export const help = {
  body: 'סיור קצר, מדריכים, או דיווח על בעיה.',
  overview: 'הראה לי איך המערכת עובדת',
  pipeline: 'סיור בלידים',
  guides: 'מדריכים',
  problem: 'יש לי בעיה',
  copilotHint: 'J + ⌘  העוזר החכם',
} as const

/** The add button is `leads.empty.addLead`. */
export const leadsEmpty = {
  title: 'אין כרגע לידים',
  body: 'כדי להתחיל את סיור הלידים, הוסף לפחות ליד אחד.',
  dismiss: 'הבנתי',
} as const
