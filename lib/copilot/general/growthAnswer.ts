import { getTodaysMeetings } from '@/db/meetings'
import {
  getFollowUpsDueToday,
  getLeadsNotContactedRecently,
  getNewLeadsThisWeek,
  getOverdueTaskSummary,
  getUnreadInboxSummary,
  type Scope,
} from '@/db/briefing'
import { composeGrowthCopy } from './growthCopy'

export async function buildGrowthAnswer(
  scope: Scope,
  user: { agencyId: number; id: number },
): Promise<{ kind: 'guide'; answer: string }> {
  const [overdue, dueToday, stale, inbox, newLeads, meetings] = await Promise.all([
    getOverdueTaskSummary(scope),
    getFollowUpsDueToday(scope),
    getLeadsNotContactedRecently(scope),
    getUnreadInboxSummary(scope),
    getNewLeadsThisWeek(scope),
    getTodaysMeetings({ agencyId: user.agencyId, organizerUserId: user.id }),
  ])
  return {
    kind: 'guide',
    answer: composeGrowthCopy({
      overdueTasks: overdue.total,
      dueToday: dueToday.total,
      staleLeads: stale.total,
      waitingConversations: inbox.conversations,
      newLeads: newLeads.total,
      meetingsToday: meetings.length,
    }),
  }
}
