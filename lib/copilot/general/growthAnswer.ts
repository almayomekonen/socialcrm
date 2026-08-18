import { getTodaysMeetings } from '@/db/meetings'
import {
  getFollowUpsDueToday,
  getLeadsNotContactedRecently,
  getNewLeadsThisWeek,
  getOverdueTaskSummary,
  type Scope,
} from '@/db/briefing'
import type { Roles } from '@/types/roles'
import { composeBusinessAdvice, type BusinessAdviceKind, type GrowthCounts } from './businessAdvice'
import { countWaitingWhatsappConversations } from './waitingInbound'

type CountsActor = { agencyId: number; id: number; role: Roles }

export async function loadBusinessCounts(scope: Scope, user: CountsActor): Promise<GrowthCounts> {
  const [overdue, dueToday, stale, waitingConversations, newLeads, meetings] = await Promise.all([
    getOverdueTaskSummary(scope),
    getFollowUpsDueToday(scope),
    getLeadsNotContactedRecently(scope),
    countWaitingWhatsappConversations(user, scope),
    getNewLeadsThisWeek(scope),
    getTodaysMeetings({ agencyId: user.agencyId, organizerUserId: user.id }),
  ])
  return {
    overdueTasks: overdue.total,
    dueToday: dueToday.total,
    staleLeads: stale.total,
    waitingConversations,
    newLeads: newLeads.total,
    meetingsToday: meetings.length,
  }
}

export async function buildBusinessAdviceAnswer(
  kind: BusinessAdviceKind,
  scope: Scope,
  user: CountsActor,
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
  user: CountsActor,
): Promise<{ kind: 'data'; intent: 'business.advice'; payload: { summary: string; counts: GrowthCounts; adviceKind: BusinessAdviceKind } }> {
  return buildBusinessAdviceAnswer('advice', scope, user)
}
