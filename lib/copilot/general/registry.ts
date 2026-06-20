export const BRIEFING_INTENT_IDS = [
  'followups.dueToday',
  'leads.notContactedRecently',
  'tasks.overdue',
  'meetings.today',
  'leads.newThisWeek',
  'inbox.unread',
  'crm.attention',
] as const
export type BriefingIntentId = (typeof BRIEFING_INTENT_IDS)[number]

/** A data Q&A intent that is NOT a briefing section: one-line whole-system status. */
export const SYSTEM_OVERVIEW_ID = 'system.overview' as const
export const SYSTEM_OVERVIEW_EXAMPLES = ['מה מצב המערכת', 'מה המצב', 'סיכום כללי', 'תמונת מצב', 'מה קורה היום']

export type GeneralIntentId = BriefingIntentId | typeof SYSTEM_OVERVIEW_ID | `guide.${string}` | 'unknown'

/** Hebrew example utterances per briefing intent — feeds the classifier + the fallback chips. */
export const BRIEFING_EXAMPLES: Record<BriefingIntentId, string[]> = {
  'followups.dueToday': ['מי צריך מעקב היום', 'מעקבים להיום', 'מי לחזור אליו היום'],
  'leads.notContactedRecently': ['מי לא דיברתי איתו מזמן', 'לידים מוזנחים', 'לידים שלא בקשר'],
  'tasks.overdue': ['משימות באיחור', 'מה עבר את התאריך', 'משימות שעברו'],
  'meetings.today': ['פגישות היום', 'מה יש לי היום ביומן', 'אילו פגישות יש לי היום'],
  'leads.newThisWeek': ['לידים חדשים השבוע', 'כמה נכנסו השבוע', 'לידים חדשים'],
  'inbox.unread': ['סכם את התיבה', 'הודעות שלא נקראו', 'מה יש בתיבה'],
  'crm.attention': ['מה דורש תשומת לב', 'על מה להתמקד היום', 'מה דחוף'],
}
