import type { BriefingSection } from '@/lib/copilot/general/types'

type SectionId = BriefingSection['id']

/** Hebrew card titles per briefing section. */
export const SECTION_TITLE: Record<SectionId, string> = {
  'tasks.overdue': 'משימות באיחור',
  'followups.dueToday': 'מעקבים להיום',
  'meetings.today': 'פגישות היום',
  'inbox.unread': 'הודעות שלא נקראו',
  'leads.notContactedRecently': 'לידים שלא בקשר',
  'leads.newThisWeek': 'לידים חדשים השבוע',
}

/** Calm per-section empty line (shown inside the card, never a blank/zero card). */
export const SECTION_EMPTY: Record<SectionId, string> = {
  'tasks.overdue': 'אין משימות באיחור',
  'followups.dueToday': 'אין מעקבים להיום',
  'meetings.today': 'אין פגישות היום',
  'inbox.unread': 'אין הודעות חדשות',
  'leads.notContactedRecently': 'הכול בקשר',
  'leads.newThisWeek': 'אין לידים חדשים השבוע',
}
