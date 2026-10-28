import { Suspense } from 'react'
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
import { getFacebookConnectionState } from '@/db/facebook'
import { getWhatsappConnectionState } from '@/db/whatsapp'
import { isMobileRequest } from '@/lib/device'
import { canEnterMobileWorkspace } from '@/lib/flags/mobileFlags'
import MobileToday from '@/modules/today/mobile/MobileToday'
import MobileTodayEmpty from '@/modules/today/mobile/MobileTodayEmpty'
import { modelFromBrief, modelFromSnapshot } from '@/modules/today/mobile/viewModel'
import { getDashboardStats } from '@/db/reports/dashboardStats'
import { parseDashboardRange } from '@/lib/dashboard/stats'
import AnalyticsOverview from '@/components/home/dashboard/AnalyticsOverview'
import FunnelCard from '@/components/home/dashboard/FunnelCard'
import { AnalyticsOverviewSkeleton, FunnelSkeleton } from '@/components/home/dashboard/AnalyticsSkeleton'

export default async function DashboardPage({ searchParams }: { searchParams?: Promise<{ range?: string | string[] }> }) {
  const user = await getUser()
  if (!user) redirect('/auth')

  // Same single source of truth the layout gate uses — the two can never
  // disagree about whether this request is the mobile workspace.
  const mobile = (await isMobileRequest()) && canEnterMobileWorkspace(user.agencyId)

  const { gotPermIds, hasLeads } = await resolveTodayScope(user)

  // Hoisted above the branches: every lead-contact control on this page needs it,
  // not just the first-run surface. One indexed single-row lookup.
  const wa =
    user.agencyId != null ? await getWhatsappConnectionState(user.agencyId) : { connected: false }
  const whatsappConnected = wa.connected

  if (!hasLeads) {
    // Desktop keeps its existing redirect to LeadsFirstRun. Mobile renders the
    // same first-run surface as empty /leads — add, import, or connect channels.
    if (!mobile) redirect('/leads')
    const meta = await getFacebookConnectionState(user.id)
    return (
      <MobileTodayEmpty
        metaConnected={meta.connected && !meta.needsReconnect}
        whatsappConnected={whatsappConnected}
      />
    )
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
      if (mobile) return <MobileToday model={modelFromBrief(brief)} whatsappConnected={whatsappConnected} />

      // Desktop analytics (KPIs, charts, funnel) stream in after the brief. One
      // promise feeds both boundaries; a failure renders an explicit error card
      // instead of taking the brief down with it.
      const range = parseDashboardRange((await searchParams)?.range)
      const stats = getDashboardStats(
        { user, scope: { user: { role: user.role }, gotPermIds, agencyId: user.agencyId }, agencyId: user.agencyId },
        range,
        Date.now(),
      ).catch((err) => {
        console.error('[dashboard] analytics failed', { agencyId: user.agencyId, error: err instanceof Error ? err.message : String(err) })
        return null
      })
      return (
        <TodayBriefView
          brief={brief}
          overview={
            <Suspense key={range} fallback={<AnalyticsOverviewSkeleton />}>
              <AnalyticsOverview stats={stats} />
            </Suspense>
          }
          funnel={
            <Suspense fallback={<FunnelSkeleton />}>
              <FunnelCard stats={stats} />
            </Suspense>
          }
        />
      )
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

  if (mobile) return <MobileToday model={modelFromSnapshot(snapshot, now)} whatsappConnected={whatsappConnected} />

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

      <RecommendedLeads
        items={recommended.map((r) => ({
          lead: { id: r.lead.id, name: r.lead.name, phone: r.lead.phone },
          reason: r.reason,
          conversationId: r.conversationId,
          windowHint: r.windowHint,
          eyebrow: r.eyebrow,
        }))}
      />

      <FollowupsTable rows={tableRows} total={tableTotal} whatsappConnected={whatsappConnected} />

      <QuickLinks dueCount={dueCount} newCount={newLeadsCount} upcomingCount={upcomingCount} meetingsCount={meetings.length} />
    </div>
  )
}
