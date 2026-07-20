import { redirect } from 'next/navigation'
import { getUser } from '@/db/auth'
import { getPerms } from '@/db/filter'
import { hasAnyLeads } from '@/db/clients'
import { getDueWorklist, getDueWorklistCount, getNewLeads, getNewLeadsCount, getDoneTodayCount } from '@/db/worklist'
import { getTodaysMeetings } from '@/db/meetings'
import { getUpcomingFollowUpsCount } from '@/db/followUps'
import { pickTopRecommended } from '@/lib/leads/recommend'
import FollowupsTable from '@/components/home/FollowupsTable'
import QuickLinks from '@/components/home/QuickLinks'
import DashboardHero from '@/components/home/DashboardHero'
import MissionSection from '@/components/home/MissionSection'
import { greetingBucket } from '@/components/home/dashboard/greeting'
import { waitingSinceMs, waitingString } from '@/components/home/dashboard/waiting'

export default async function DashboardPage() {
  const user = await getUser()
  if (!user) redirect('/auth')

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
  const greeting = greetingBucket(new Date())
  const leadsWaiting = dueCount + newLeadsCount
  const firstName = user.name?.trim().split(/\s+/)[0] ?? ''

  const missionItems = recommended.map((r) => ({
    lead: { id: r.lead.id, name: r.lead.name, phone: r.lead.phone },
    reason: r.reason,
    waiting: waitingString(waitingSinceMs(r.lead), now),
  }))

  return (
    <div className='mb-8 grid gap-4'>
      <DashboardHero
        firstName={firstName}
        greeting={greeting}
        leadsWaiting={leadsWaiting}
        doneToday={doneToday}
        progressTotal={progressTotal}
        progressPct={progressPct}
        remaining={dueCount}
      />

      <MissionSection items={missionItems} />

      <FollowupsTable rows={tableRows} total={tableTotal} />

      <QuickLinks dueCount={dueCount} newCount={newLeadsCount} upcomingCount={upcomingCount} meetingsCount={meetings.length} />
    </div>
  )
}
