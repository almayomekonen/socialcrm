// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { renderToString as renderRaw } from 'react-dom/server'
import { resolveAsync } from './dashboardHarness'
import { DUE_ROWS, NEW_LEADS, NOW, STATS, VIEWER, WAITERS } from './dashboardFixtures'

/**
 * HEBREW BASELINE for /dashboard. The snapshots in __snapshots__ were recorded
 * against the code BEFORE Phase B; every Hebrew render and every server-side
 * label must still match them byte-for-byte after localization. A diff here is
 * a change to what existing customers read. (Only React's invisible `<!-- -->`
 * text separators are normalized; see renderToString below.)
 */

const env = { mobile: false, v2: true, stats: STATS as typeof STATS | null }

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
  usePathname: () => '/dashboard',
  redirect: (to: string) => {
    throw new Error('REDIRECT ' + to)
  },
}))
vi.mock('@/db/auth', () => ({ getUser: async () => ({ id: 9001, name: 'דנה כהן', firstName: 'דנה', role: 'ADMIN', agencyId: 103 }) }))
vi.mock('@/db/uiLocale', () => ({ getUiLocalePrefs: async () => ({ userLocale: null, agencyLocale: null }) }))
vi.mock('@/db/filter', () => ({ getPerms: async () => ({ gotPermIds: [] }) }))
vi.mock('@/db/clients', () => ({ hasAnyLeads: async () => true }))
vi.mock('@/db/worklist', async () => {
  const f = await import('./dashboardFixtures')
  return {
    getDueWorklist: async () => f.DUE_ROWS,
    getDueWorklistCount: async () => f.DUE_ROWS.length,
    getNewLeads: async () => f.NEW_LEADS,
    getNewLeadsCount: async () => f.NEW_LEADS.length,
    getDoneTodayCount: async () => 2,
  }
})
vi.mock('@/db/followUps', () => ({ getUpcomingFollowUpsCount: async () => 4 }))
vi.mock('@/db/inboxWaiting', async () => {
  const f = await import('./dashboardFixtures')
  return {
    listOldestWaitingWhatsappByLeadIds: async () => f.WAITERS,
    findOldestWaitingWhatsappConversation: async () => f.WAITERS[0],
  }
})
vi.mock('@/db/meetings', async () => ({ getTodaysMeetings: async () => (await import('./dashboardFixtures')).MEETINGS }))
vi.mock('@/db/today/facts', async () => ({ getBriefCandidateFacts: async () => (await import('./dashboardFixtures')).FACTS }))
vi.mock('@/db/today/handled', () => ({ getTouchedTodayIds: async () => [7, 8] }))
vi.mock('@/db/today/freshness', () => ({ getInboundSyncFreshness: async () => ({ dataFresh: true }) }))
vi.mock('@/db/facebook', () => ({ getFacebookConnectionState: async () => ({ connected: false }) }))
vi.mock('@/db/whatsapp', () => ({ getWhatsappConnectionState: async () => ({ connected: true }) }))
vi.mock('@/db/reports/dashboardStats', () => ({ getDashboardStats: async () => env.stats }))
vi.mock('@/lib/today/telemetry', () => ({ logBriefServed: () => {}, logBriefFailure: () => {} }))
vi.mock('@/lib/today/rollout', () => ({ isTodayBriefEnabledForAgency: () => env.v2 }))
vi.mock('@/lib/device', () => ({ isMobileRequest: async () => env.mobile }))
vi.mock('@/actions/leadOutcome', () => ({ logLeadOutcome: async () => ({}) }))
vi.mock('@/actions/analytics/recordLeadActionEvent', () => ({ recordLeadActionEvent: async () => {} }))
vi.mock('@/modules/leads/contactLead', () => ({ contactLeadViaWhatsapp: () => {} }))
vi.mock('@/modules/inbox/client/openLeadWhatsapp', () => ({ openLeadWhatsappInInbox: async () => {}, WHATSAPP_CONNECT_HREF: '/settings/integrations' }))
vi.mock('@/components/mobile/MobileHeaderAction', () => ({ useSetMobileHeaderAction: () => {} }))
vi.mock('@/modules/leads/mobile/LeadFormMobile', () => ({ default: () => null }))
vi.mock('@/modules/leads/mobile/LeadImportMobile', () => ({ default: () => null }))
vi.mock('@/modules/leads/mobile/LeadsAddSheet', () => ({ default: () => null }))

const { default: DashboardPage } = await import('@/components/home/DashboardPage')

/**
 * React separates adjacent text nodes with `<!-- -->` in server HTML. They are
 * not user-visible, and `{a} text {b}` vs one translated string differ only in
 * them, so they are stripped before comparing. Everything else is compared raw.
 */
function renderToString(node: Parameters<typeof renderRaw>[0]) {
  return renderRaw(node).replaceAll('<!-- -->', '')
}

async function renderDashboard() {
  const tree = await resolveAsync(await DashboardPage({ searchParams: Promise.resolve({}) }))
  return renderToString(<>{tree}</>)
}

const savedEnv = { ...process.env }
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  process.env.MOBILE_WORKSPACE_ENABLED = '1'
  process.env.MOBILE_WORKSPACE_AGENCY_ALLOWLIST = '103'
})
afterAll(() => {
  vi.useRealTimers()
  process.env = { ...savedEnv }
})

describe('Hebrew baseline — /dashboard renders', () => {
  test('desktop, Today brief v2 with analytics', async () => {
    Object.assign(env, { mobile: false, v2: true, stats: STATS })
    expect(await renderDashboard()).toMatchSnapshot()
  })

  test('desktop, analytics unavailable', async () => {
    Object.assign(env, { mobile: false, v2: true, stats: null })
    expect(await renderDashboard()).toMatchSnapshot()
  })

  test('desktop, legacy worklist (brief v2 off)', async () => {
    Object.assign(env, { mobile: false, v2: false, stats: STATS })
    expect(await renderDashboard()).toMatchSnapshot()
  })

  test('mobile, brief v2', async () => {
    Object.assign(env, { mobile: true, v2: true, stats: STATS })
    expect(await renderDashboard()).toMatchSnapshot()
  })

  test('mobile, legacy worklist', async () => {
    Object.assign(env, { mobile: true, v2: false, stats: STATS })
    expect(await renderDashboard()).toMatchSnapshot()
  })

  test('analytics skeletons', async () => {
    const { AnalyticsOverviewSkeleton, FunnelSkeleton } = await import('@/components/home/dashboard/AnalyticsSkeleton')
    expect(renderToString(<>{AnalyticsOverviewSkeleton()}{FunnelSkeleton()}</>)).toMatchSnapshot()
  })
})

describe('Hebrew baseline — server-side label producers (default arguments)', () => {
  test('labels, greetings, durations, waiting copy, recommendations, sources, day labels', async () => {
    const { reasonFor } = await import('@/lib/today/labels')
    const { greetingFor } = await import('@/lib/today/greeting')
    const { formatCoarseDurationHe, waitingReplyCopy } = await import('@/lib/inbox/waitingReplyCopy')
    const { recommendReason } = await import('@/lib/leads/recommend')
    const { leadSourceLabel } = await import('@/lib/leads/leadSourceLabel')
    const { dayLabels } = await import('@/lib/dashboard/stats')
    const { formatBusinessLongDate, formatBusinessTime } = await import('@/lib/today/time')
    const { buildTodayBrief } = await import('@/lib/today/service')
    const { mergeWaitingSpotlight } = await import('@/modules/today/waitingSpotlight')
    const { pickTopRecommended } = await import('@/lib/leads/recommend')
    const { modelFromBrief, modelFromSnapshot } = await import('@/modules/today/mobile/viewModel')
    const H = 3_600_000
    const states = ['WAITING_REPLY', 'FOLLOWUP_OVERDUE', 'FOLLOWUP_DUE_TODAY', 'NEW_INBOUND', 'OVERDUE_TASK', 'OPEN_LOOP_SLA'] as const
    const ages = [20_000, 60_000, 5 * 60_000, H, 3 * H, 23.5 * H, 24 * H, 26 * H, 3 * 24 * H]
    const brief = await buildTodayBrief(VIEWER, NOW)
    const recommended = mergeWaitingSpotlight(pickTopRecommended(DUE_ROWS, NEW_LEADS, 3, NOW), WAITERS[0], NOW, 3)
    const snapshot = {
      due: DUE_ROWS, dueCount: 3, newLeadsCount: 1, upcomingCount: 4, doneToday: 2, meetings: [],
      recommended, tableRows: DUE_ROWS.filter((r) => !recommended.some((x) => x.lead.id === r.id)), tableTotal: 2, progressPct: 40,
    }
    // Phase B adds locale-independent CODE fields next to the display strings.
    // They did not exist when this baseline was recorded, so they are dropped
    // before comparing; every pre-existing field must still match exactly.
    const PHASE_B_CODE_FIELDS = new Set(['reasonCode', 'windowState', 'tones'])
    const withoutCodes = (v: unknown): unknown => {
      if (Array.isArray(v)) return v.map(withoutCodes)
      if (v instanceof Date || v === null || typeof v !== 'object') return v
      return Object.fromEntries(
        Object.entries(v).filter(([k]) => !PHASE_B_CODE_FIELDS.has(k)).map(([k, x]) => [k, withoutCodes(x)]),
      )
    }
    expect(withoutCodes({
      reasons: states.map((s) => reasonFor(s)),
      greetings: [3, 8, 13, 20].map((h) => greetingFor(Date.parse(`2026-10-28T${String(h - 2).padStart(2, '0')}:00:00Z`))),
      durations: ages.map(formatCoarseDurationHe),
      waiting: ages.map((a) => waitingReplyCopy({ lastInboundAt: NOW - a, lastHumanOutboundAt: null, nowMs: NOW, channel: 'whatsapp' })),
      recommend: [...DUE_ROWS, ...NEW_LEADS].map((r) => recommendReason(r, NOW)),
      sources: ['whatsapp:1', 'facebook:1', 'instagram:1', 'contact_form_7:x', 'manual', null, 'utm_campaign_x'].map((s) => leadSourceLabel(s)),
      days: ['2026-10-25', '2026-10-26', '2026-10-31'].map((d) => dayLabels(d)),
      dates: [formatBusinessLongDate(NOW), formatBusinessTime(NOW)],
      brief,
      recommended,
      mobileBrief: modelFromBrief(brief),
      mobileSnapshot: modelFromSnapshot(snapshot, NOW),
    })).toMatchSnapshot()
  })
})

describe('Hebrew baseline — component states the page fixture does not reach', () => {
  test('hero headline/subline variants', async () => {
    const { default: BriefHero } = await import('@/components/home/today/BriefHero')
    const { buildTodayBrief } = await import('@/lib/today/service')
    const base = await buildTodayBrief(VIEWER, NOW)
    const variants = [
      { ...base, done: true, remaining: 0, statusVerdict: 'covered' as const },
      { ...base, done: true, remaining: 0, statusVerdict: 'active' as const },
      { ...base, done: false, remaining: 1, statusVerdict: 'unconfirmed' as const },
      { ...base, done: false, remaining: 9, volumeState: 'busy' as const, statusVerdict: 'active' as const },
      { ...base, done: false, remaining: 2, handledToday: 0, volumeState: 'normal' as const, statusVerdict: 'active' as const, meetings: base.meetings.slice(0, 1) },
    ]
    expect(variants.map((b) => renderToString(<BriefHero brief={b} />))).toMatchSnapshot()
  })

  test('legacy recommended without eyebrow, followups pagination', async () => {
    const { default: RecommendedLeads } = await import('@/components/home/RecommendedLeads')
    const { default: FollowupsTable } = await import('@/components/home/FollowupsTable')
    const many = Array.from({ length: 11 }, (_, i) => ({ ...DUE_ROWS[i % DUE_ROWS.length], id: 100 + i }))
    expect([
      renderToString(<RecommendedLeads items={[{ lead: { id: 4, name: 'יוסי לוי', phone: '0549998877' }, reason: 'ליד חדש' }]} />),
      renderToString(<FollowupsTable rows={many} total={11} whatsappConnected />),
      renderToString(<FollowupsTable rows={[]} total={0} />),
    ]).toMatchSnapshot()
  })

  test('mobile clear state and hero without eyebrow', async () => {
    const { default: MobileToday } = await import('@/modules/today/mobile/MobileToday')
    const { default: MobileTodayHero } = await import('@/modules/today/mobile/MobileTodayHero')
    const empty = { hero: null, nextUp: [], rest: [], remaining: 0, restTotal: 0, doneToday: 3, meetings: 2, newLeadsCount: 5, source: 'brief_v2' as const }
    expect([
      renderToString(<MobileToday model={empty} />),
      renderToString(<MobileToday model={{ ...empty, doneToday: 0, meetings: 0, newLeadsCount: 0 }} />),
      renderToString(<MobileTodayHero row={{ id: 4, name: null, phone: null, reason: 'ליד חדש', href: '/clients/4/summary' }} remaining={0} />),
    ]).toMatchSnapshot()
  })
})
