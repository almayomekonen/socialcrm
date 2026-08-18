import { getTodaysMeetings } from '@/db/meetings'
import {
  getFollowUpsDueToday,
  getLeadsNotContactedRecently,
  getNewLeadsThisWeek,
  getOverdueTaskSummary,
  getUnreadInboxSummary,
  type Scope,
} from '@/db/briefing'
import { composeBusinessAdvice, type BusinessAdviceKind, type GrowthCounts } from './businessAdvice'

export async function loadBusinessCounts(
  scope: Scope,
  user: { agencyId: number; id: number },
): Promise<GrowthCounts> {
  const [overdue, dueToday, stale, inbox, newLeads, meetings] = await Promise.all([
    getOverdueTaskSummary(scope),
    getFollowUpsDueToday(scope),
    getLeadsNotContactedRecently(scope),
    getUnreadInboxSummary(scope),
    getNewLeadsThisWeek(scope),
    getTodaysMeetings({ agencyId: user.agencyId, organizerUserId: user.id }),
  ])
  return {
    overdueTasks: overdue.total,
    dueToday: dueToday.total,
    staleLeads: stale.total,
    waitingConversations: inbox.conversations,
    newLeads: newLeads.total,
    meetingsToday: meetings.length,
  }
}

export async function buildBusinessAdviceAnswer(
  kind: BusinessAdviceKind,
  scope: Scope,
  user: { agencyId: number; id: number },
): Promise<{ kind: 'data'; intent: 'business.advice'; payload: { summary: string; counts: GrowthCounts; adviceKind: BusinessAdviceKind } }> {
  const counts = await loadBusinessCounts(scope, user)
  return {
    kind: 'data',
    intent: 'business.advice',
    payload: { summary: composeBusinessAdvice(kind, counts), counts, adviceKind: kind },
  }
}

export async function buildGrowthAnswer(
  scope: Scope,
  user: { agencyId: number; id: number },
): Promise<{ kind: 'data'; intent: 'business.advice'; payload: { summary: string; counts: GrowthCounts; adviceKind: BusinessAdviceKind } }> {
  return buildBusinessAdviceAnswer('advice', scope, user)
}
