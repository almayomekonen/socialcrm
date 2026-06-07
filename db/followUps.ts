import { db } from '@/config/db'
import { getAgencyId } from './agencies'
import { isAdmin, type Roles } from '@/types/roles'
import { getAgencyPlan } from '@/lib/quota'
import type { UpcomingFollowUp } from '@/lib/leads/upcomingFollowUps'

export async function getUpcomingFollowUps({
  user,
  gotPermIds,
  limit = 10,
}: {
  user: { role: Roles }
  gotPermIds: number[]
  limit?: number
}): Promise<UpcomingFollowUp[]> {
  const agencyId = await getAgencyId()
  const plan = await getAgencyPlan(agencyId)

  const q = db('clients')
    .where({ agencyId })
    .where('lead', true) // match the dashboard's lead universe — exclude converted deals (lead=false)
    .whereNotNull('nextFollowUpAt')
    .where('nextFollowUpAt', '>', db.fn.now())
    .whereNotIn('status', ['closed', 'lost'])
    .select('id', 'name', 'phone', 'status', 'nextFollowUpAt', 'followUpNote')
    .orderBy('nextFollowUpAt', 'asc')
    .orderBy('id', 'asc')
    .limit(limit + 1)

  if (gotPermIds && !isAdmin(user.role)) q.whereIn('userId', gotPermIds)
  if (plan === 'free') q.where('overQuota', false)

  return q as unknown as Promise<UpcomingFollowUp[]>
}

/** True count of upcoming (future, not-yet-due) follow-ups — for the Quick Links chip (uncapped). */
export async function getUpcomingFollowUpsCount({ user, gotPermIds }: { user: { role: Roles }; gotPermIds: number[] }): Promise<number> {
  const agencyId = await getAgencyId()
  const plan = await getAgencyPlan(agencyId)

  const q = db('clients')
    .where({ agencyId })
    .where('lead', true)
    .whereNotNull('nextFollowUpAt')
    .where('nextFollowUpAt', '>', db.fn.now())
    .whereNotIn('status', ['closed', 'lost'])
  if (gotPermIds && !isAdmin(user.role)) q.whereIn('userId', gotPermIds)
  if (plan === 'free') q.where('overQuota', false)

  const row = await q.count<Array<{ count?: string | number }>>('id as count').first()
  return Number(row?.count ?? 0)
}
