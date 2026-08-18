import { getTodaysMeetings } from '@/db/meetings'
import {
  getFollowUpsDueToday,
  getLeadsNotContactedRecently,
  getNewLeadsThisWeek,
  getOverdueTaskSummary,
  getUnreadInboxSummary,
  type Scope,
} from '@/db/briefing'
import { composeOverviewSentence } from './overviewSentence'
import type { FactBucketId } from './conversationState'
import { Roles } from '@/types/roles'

export type BriefingActor = { agencyId: number; id: number; role: Roles }

export async function runBriefingIntent(intent: string, user: BriefingActor, scope: Scope): Promise<unknown> {
  switch (intent as FactBucketId | 'crm.attention' | 'system.overview') {
    case 'followups.dueToday':
      return getFollowUpsDueToday(scope)
    case 'leads.notContactedRecently':
      return getLeadsNotContactedRecently(scope)
    case 'tasks.overdue':
      return getOverdueTaskSummary(scope)
    case 'meetings.today':
      return { meetings: await getTodaysMeetings({ agencyId: user.agencyId, organizerUserId: user.id }) }
    case 'leads.newThisWeek':
      return getNewLeadsThisWeek(scope)
    case 'inbox.unread':
      return getUnreadInboxSummary(scope)
    case 'crm.attention': {
      const [dueToday, overdue, stale] = await Promise.all([
        getFollowUpsDueToday(scope),
        getOverdueTaskSummary(scope),
        getLeadsNotContactedRecently(scope),
      ])
      return { overdue, dueToday, stale }
    }
    case 'system.overview': {
      const [overdue, meetings, inbox, stale, newLeads] = await Promise.all([
        getOverdueTaskSummary(scope),
        getTodaysMeetings({ agencyId: user.agencyId, organizerUserId: user.id }),
        getUnreadInboxSummary(scope),
        getLeadsNotContactedRecently(scope),
        getNewLeadsThisWeek(scope),
      ])
      const counts = {
        overdueTasks: overdue.total,
        meetingsToday: meetings.length,
        waitingConversations: inbox.conversations,
        staleLeads: stale.total,
        newLeads: newLeads.total,
      }
      return { summary: composeOverviewSentence(counts), counts }
    }
    default:
      return {}
  }
}
