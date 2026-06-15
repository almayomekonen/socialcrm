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

export type GeneralIntentId = BriefingIntentId | `guide.${string}` | 'unknown'

/** Hebrew example utterances per briefing intent — feeds the classifier + the menu. */
export const BRIEFING_EXAMPLES: Record<BriefingIntentId, string[]> = {
  'followups.dueToday': ['מי צריך מעקב היום', 'מעקבים להיום', 'מי לחזור אליו היום'],
  'leads.notContactedRecently': ['מי לא דיברתי איתו מזמן', 'לידים מוזנחים', 'לידים שלא בקשר'],
  'tasks.overdue': ['משימות באיחור', 'מה עבר את התאריך', 'משימות שעברו'],
  'meetings.today': ['פגישות היום', 'מה יש לי היום ביומן', 'אילו פגישות יש לי היום'],
  'leads.newThisWeek': ['לידים חדשים השבוע', 'כמה נכנסו השבוע', 'לידים חדשים'],
  'inbox.unread': ['סכם את התיבה', 'הודעות שלא נקראו', 'מה יש בתיבה'],
  'crm.attention': ['מה דורש תשומת לב', 'על מה להתמקד היום', 'מה דחוף'],
}
