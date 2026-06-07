import { redirect } from 'next/navigation'
import { getUser } from '@/db/auth'
import { getPerms } from '@/db/filter'
import { hasAnyLeads } from '@/db/clients'
import { getDueWorklist, getDueWorklistCount, getNewLeads, getNewLeadsCount, getDoneTodayCount } from '@/db/worklist'
import { getTodaysMeetings } from '@/db/meetings'
import { getUpcomingFollowUpsCount } from '@/db/followUps'
import { pickTopRecommended } from '@/lib/leads/recommend'
import RecommendedLeads from '@/components/home/RecommendedLeads'
import FollowupsTable from '@/components/home/FollowupsTable'
import QuickLinks from '@/components/home/QuickLinks'

export default async function DashboardPage() {
  const user = await getUser()
  const { gotPermIds } = await getPerms(user)

  if (!(await hasAnyLeads(user.agencyId, gotPermIds, user.role))) redirect('/leads')

  const [due, dueCount, newLeads, meetings, doneToday, newLeadsCount, upcomingCount] = await Promise.all([
    getDueWorklist({ user, gotPermIds, limit: 100 }),
    getDueWorklistCount({ user, gotPermIds }),
    getNewLeads({ user, gotPermIds }),
    getTodaysMeetings({ agencyId: user.agencyId, organizerUserId: user.id }),
    getDoneTodayCount({ user, gotPermIds }),
    getNewLeadsCount({ user, gotPermIds }),
    getUpcomingFollowUpsCount({ user, gotPermIds }),
  ])

  const now = Date.now()
  const recommended = pickTopRecommended(due, newLeads, 3, now)

  const recommendedIds = new Set(recommended.map((r) => r.lead.id))
  const dueIds = new Set(due.map((d) => d.id))
  const tableRows = due.filter((r) => !recommendedIds.has(r.id))
  const removedFromDue = recommended.filter((r) => dueIds.has(r.lead.id)).length
  const tableTotal = dueCount - removedFromDue

  const progressTotal = doneToday + dueCount
  const progressPct = progressTotal > 0 ? Math.round((doneToday / progressTotal) * 100) : 100

  return (
    <div className='mb-8 grid gap-4'>
      <div>
        <h1 className='title mb-1'>היום</h1>
        <p className='text-sm text-gray-700 tabular-nums'>
          <span className='font-medium text-gray-900'>{`${doneToday} טופלו`}</span>
          {` · ${dueCount} נותרו`}
          {meetings.length > 0 ? ` · ${meetings.length} פגישות` : ''}
        </p>
        <div className='mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-200'>
          <div className='h-full rounded-full bg-primary transition-all' style={{ width: `${progressPct}%` }} />
        </div>
      </div>

      <RecommendedLeads items={recommended.map((r) => ({ lead: { id: r.lead.id, name: r.lead.name, phone: r.lead.phone }, reason: r.reason }))} />

      <FollowupsTable rows={tableRows} total={tableTotal} />

      <QuickLinks dueCount={dueCount} newCount={newLeadsCount} upcomingCount={upcomingCount} meetingsCount={meetings.length} />
    </div>
  )
}
