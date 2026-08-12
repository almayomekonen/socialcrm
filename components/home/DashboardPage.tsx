import { redirect } from 'next/navigation'
import { getUser } from '@/db/auth'
import RecommendedLeads from '@/components/home/RecommendedLeads'
import FollowupsTable from '@/components/home/FollowupsTable'
import QuickLinks from '@/components/home/QuickLinks'
import { isTodayBriefEnabledForAgency } from '@/lib/today/rollout'
import { buildTodayBrief } from '@/lib/today/service'
import { logBriefServed, logBriefFailure } from '@/lib/today/telemetry'
import TodayBriefView from '@/components/home/today/TodayBriefView'
import { getFirstName } from '@/lib/users/displayName'
import { resolveTodayScope, resolveTodaySnapshot } from '@/modules/today/queries'
import { isMobileRequest } from '@/lib/device'
import { canEnterMobileWorkspace } from '@/lib/flags/mobileFlags'
import MobileToday from '@/modules/today/mobile/MobileToday'
import MobileTodayEmpty from '@/modules/today/mobile/MobileTodayEmpty'
import { modelFromBrief, modelFromSnapshot } from '@/modules/today/mobile/viewModel'

export default async function DashboardPage() {
  const user = await getUser()
  if (!user) redirect('/auth')

  // Same single source of truth the layout gate uses — the two can never
  // disagree about whether this request is the mobile workspace.
  const mobile = (await isMobileRequest()) && canEnterMobileWorkspace(user.agencyId)

  const { gotPermIds, hasLeads } = await resolveTodayScope(user)

  if (!hasLeads) {
    // Desktop keeps its existing redirect to the first-run screen. Mobile does
    // NOT: /leads on a phone is the Phase 2 handoff, so redirecting a brand-new
    // mobile user there would land them on "not here yet" as the very first
    // thing they see. They get a real empty state instead.
    if (!mobile) redirect('/leads')
    return <MobileTodayEmpty />
  }

  // Today Brief v2 — rollout-gated, RSC-only, DARK by default (TODAY_BRIEF_V2 unset
  // ⇒ this branch never runs ⇒ the original dashboard below is served byte-for-byte).
  // Consumes ONLY buildTodayBrief. Any failure falls through to the original dashboard
  // (instant per-request rollback, no redeploy).
  if (user.agencyId != null && isTodayBriefEnabledForAgency(user.agencyId)) {
    const startedAt = Date.now()
    try {
      const firstName = getFirstName(user)
      const brief = await buildTodayBrief(
        { scope: { user: { role: user.role }, gotPermIds }, agencyId: user.agencyId, userId: user.id, firstName },
        Date.now(),
      )
      logBriefServed({
        agencyId: user.agencyId,
        latencyMs: Date.now() - startedAt,
        total: brief.total,
        remaining: brief.remaining,
        empty: brief.total === 0,
      })
      // Mobile renders the SAME brief through the mobile presentation, so an
      // agency on v2 is never told to call one person on its phone and a
      // different one on its laptop.
      return mobile ? <MobileToday model={modelFromBrief(brief)} /> : <TodayBriefView brief={brief} />
    } catch (err) {
      logBriefFailure({
        agencyId: user.agencyId,
        latencyMs: Date.now() - startedAt,
        error: err instanceof Error ? err.message : String(err),
      })
      // fall through to the original dashboard
    }
  }

  const now = Date.now()
  const snapshot = await resolveTodaySnapshot(user, gotPermIds, now)

  if (mobile) return <MobileToday model={modelFromSnapshot(snapshot, now)} />

  const { recommended, tableRows, tableTotal, dueCount, doneToday, meetings, newLeadsCount, upcomingCount, progressPct } =
    snapshot

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
