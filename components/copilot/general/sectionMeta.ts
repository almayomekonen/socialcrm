import type { BriefingSection } from '@/lib/copilot/general/types'

type SectionId = BriefingSection['id']

export const SECTION_TITLE: Record<SectionId, string> = {
  'followups.promisedWaiting': 'ממתינים לתשובה ממך',
  'tasks.overdue': 'משימות באיחור',
  'followups.dueToday': 'מעקבים להיום',
  'meetings.today': 'פגישות היום',
  'inbox.unread': 'הודעות שלא נקראו',
  'leads.notContactedRecently': 'לידים שלא בקשר',
  'leads.newThisWeek': 'לידים חדשים השבוע',
}

export const SECTION_EMPTY: Record<SectionId, string> = {
  'followups.promisedWaiting': 'אין כרגע מי שממתין לתשובה',
  'tasks.overdue': 'אין משימות באיחור',
  'followups.dueToday': 'אין מעקבים להיום',
  'meetings.today': 'אין פגישות היום',
  'inbox.unread': 'אין הודעות חדשות',
  'leads.notContactedRecently': 'הכול בקשר',
  'leads.newThisWeek': 'אין לידים חדשים השבוע',
}
