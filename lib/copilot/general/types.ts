import type { BriefingLeadRow } from '@/db/briefing'

export type BriefingMeetingRow = { id: number; title: string; startAt: string; leadName: string | null }

export type BriefingSection =
  | { id: 'followups.promisedWaiting'; total: number; sample: BriefingLeadRow[] }
  | { id: 'tasks.overdue'; total: number; sample: BriefingLeadRow[] }
  | { id: 'followups.dueToday'; total: number; sample: BriefingLeadRow[] }
  | { id: 'meetings.today'; total: number; sample: BriefingMeetingRow[] }
  | { id: 'inbox.unread'; conversations: number; unread: number }
  | { id: 'leads.notContactedRecently'; total: number; sample: BriefingLeadRow[] }
  | { id: 'leads.newThisWeek'; total: number; sample: BriefingLeadRow[] }

export type BriefingResult =
  | { kind: 'empty' } // no CRM data → onboarding
  | { kind: 'briefing'; greeting: string; sections: BriefingSection[] }
  | { kind: 'locked' } // subscription lapsed → the shared expired state, not an error
