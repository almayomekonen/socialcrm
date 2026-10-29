// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { findHebrewLeaks } from './leakScan'

const prefs = { userLocale: null as string | null }

vi.mock('next/navigation', async () => {
  const { leadsEnv } = await import('./leadsEnv')
  return {
    usePathname: () => '/leads',
    useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
    useSearchParams: () => new URLSearchParams(leadsEnv.search),
    redirect: (to: string) => {
      throw new Error('REDIRECT ' + to)
    },
    notFound: () => {
      throw new Error('NEXT_NOT_FOUND')
    },
  }
})
vi.mock('@/actions/auth', () => ({ logout: async () => {} }))
vi.mock('@/actions/uiLocale', () => ({ setMyUiLocale: vi.fn(), setAgencyDefaultUiLocale: vi.fn() }))
vi.mock('@/modules/inbox/awareness/AwarenessContext', () => ({ useAwarenessCount: () => null }))
vi.mock('@/components/notifications/NotificationBell', () => ({ default: () => null }))
vi.mock('@/components/education/HelpTrigger', () => ({ default: () => null }))
vi.mock('@/db/auth', async () => ({ getUser: async () => (await import('./surfaces')).FIXTURE_USER }))
vi.mock('@/db/uiLocale', () => ({ getUiLocalePrefs: async () => ({ userLocale: prefs.userLocale, agencyLocale: null }) }))
vi.mock('@/lib/device', async () => {
  const f = await import('./dashboardFixtures')
  return { isMobileRequest: async () => f.dashboardEnv.mobile, isMobileWorkspaceRequest: async () => false }
})
vi.mock('@/lib/access/productAccess', async () => {
  const { detailEnv } = await import('./leadDetailEnv')
  return { getAgencyProductAccess: async () => ({ hasAccess: detailEnv.hasAccess }) }
})
// /dashboard reads (I/O only; every producer and component runs for real).
vi.mock('@/db/filter', async () => ({ getPerms: async () => (await import('./leadsEnv')).LEADS_PAGE_PERMS }))
vi.mock('@/db/clients', async () => {
  const { leadsEnv, CLIENT_LISTS } = await import('./leadsEnv')
  return {
    hasAnyLeads: async () => leadsEnv.hasLeads,
    getLeadLists: async () => CLIENT_LISTS,
    getLeadsTable: async () => leadsEnv.rows,
    getGlobalLatestUpdatedAt: async () => '2026-10-28T09:00:00.000Z',
    getLeadColumnAvailability: async () => ({ idNum: true, secPhone: true, birthDate: true, gender: true }),
    // Lead detail (layout + summary).
    getFullLead: async () => {
      const { detailEnv } = await import('./leadDetailEnv')
      return detailEnv.header || detailEnv.lead ? { ...(detailEnv.header ?? {}), ...(detailEnv.lead ?? {}) } : null
    },
    getFamMembers: async () => {
      const { detailEnv } = await import('./leadDetailEnv')
      return { famMembers: detailEnv.family, familyId: detailEnv.family.length ? 1 : null }
    },
  }
})
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
  return { listOldestWaitingWhatsappByLeadIds: async () => f.WAITERS, findOldestWaitingWhatsappConversation: async () => f.WAITERS[0] }
})
vi.mock('@/db/meetings', async () => ({ getTodaysMeetings: async () => (await import('./dashboardFixtures')).MEETINGS }))
vi.mock('@/db/today/facts', async () => ({ getBriefCandidateFacts: async () => (await import('./dashboardFixtures')).FACTS }))
vi.mock('@/db/today/handled', () => ({ getTouchedTodayIds: async () => [7, 8] }))
vi.mock('@/db/today/freshness', () => ({ getInboundSyncFreshness: async () => ({ dataFresh: true }) }))
vi.mock('@/db/facebook', async () => {
  const { leadsEnv } = await import('./leadsEnv')
  return { getFacebookConnectionState: async () => leadsEnv.meta }
})
// /leads and /clients reads (I/O only; the page, banners, table and producers run for real).
vi.mock('@/db/usersNTeams', async () => ({
  getDefaultSettings: async () => ({}),
  getUsers: async () => (await import('./leadsEnv')).USERS,
  getUserNameById: async () => (await import('./leadDetailEnv')).detailEnv.handlerName,
}))
vi.mock('@/lib/quota', async () => {
  const { leadsEnv } = await import('./leadsEnv')
  return { getQuotaStatus: async () => ({ overQuotaCount: leadsEnv.overQuota }) }
})
vi.mock('@/db/automations/connectionDelivery', async () => {
  const { leadsEnv } = await import('./leadsEnv')
  return { deliveryFacts: async () => leadsEnv.intakeFacts }
})
vi.mock('@/actions/clients', () => ({
  fetchLeadsSince: async () => [],
  searchContacts: async () => [],
  searchLeads: async () => [],
  updateLead: async () => ({ ok: true }),
  deleteLead: async () => ({ ok: true }),
  deleteManyLeads: async () => ({ deletedCount: 0, blockedCount: 0, blockedLeads: [] }),
  assignLeadsToRep: async () => ({ assignedCount: 0, skippedCount: 0 }),
  transferLeadToRep: async () => ({ ok: true }),
  getLeadByIdNum: async () => null,
  upsertLead: async () => ({ ok: true }),
  addLeads: async () => ({ inserted: 0 }),
  importLeadsFromCsv: async () => ({ inserted: 0 }),
  uploadLeadData: async () => ({}),
  upsertLeadList: async () => ({}),
  deleteLeadList: async () => ({}),
}))
vi.mock('@/actions/global', () => ({ saveTblPref: async () => ({ ok: true }) }))
vi.mock('@/actions/leadDuplicates', () => ({ findDuplicateLeads: async () => [] }))
vi.mock('@/actions/analytics/recordFirstLeadEvent', () => ({ recordFirstLeadEvent: async () => {} }))
// The pipeline tour is education content (out of Phase C scope, still Hebrew).
vi.mock('@/components/education/AutoTour', () => ({ default: () => null }))
vi.mock('@/db/whatsapp', () => ({ getWhatsappConnectionState: async () => ({ connected: true }) }))
vi.mock('@/db/reports/dashboardStats', async () => ({ getDashboardStats: async () => (await import('./dashboardFixtures')).dashboardEnv.stats }))
vi.mock('@/lib/today/telemetry', () => ({ logBriefServed: () => {}, logBriefFailure: () => {} }))
vi.mock('@/lib/today/rollout', async () => {
  const f = await import('./dashboardFixtures')
  return { isTodayBriefEnabledForAgency: () => f.dashboardEnv.v2 }
})
vi.mock('@/actions/leadOutcome', () => ({ logLeadOutcome: async () => ({}) }))
vi.mock('@/actions/analytics/recordLeadActionEvent', () => ({ recordLeadActionEvent: async () => {} }))
vi.mock('@/modules/leads/contactLead', () => ({ contactLeadViaWhatsapp: () => {} }))
vi.mock('@/modules/inbox/client/openLeadWhatsapp', () => ({ openLeadWhatsappInInbox: async () => {}, WHATSAPP_CONNECT_HREF: '/settings/integrations' }))
vi.mock('@/components/mobile/MobileHeaderAction', () => ({ useSetMobileHeaderAction: () => () => {} }))
vi.mock('@/modules/leads/mobile/LeadFormMobile', () => ({ default: () => null }))
vi.mock('@/modules/leads/mobile/LeadImportMobile', () => ({ default: () => null }))
vi.mock('@/modules/leads/mobile/LeadsAddSheet', () => ({ default: () => null }))

// /clients/[clientId] layout + summary reads (I/O only; the layout, page, cards and producers run for real).
vi.mock('@/lib/requireUser', async () => ({
  ...(await vi.importActual<typeof import('@/lib/requireUser')>('@/lib/requireUser')),
  requireAgencyUser: async () => (await import('./surfaces')).FIXTURE_USER,
}))
vi.mock('@/db/tasks', async () => ({ get5TasksByClientId: async () => (await import('./leadDetailEnv')).detailEnv.tasks }))
vi.mock('@/modules/inbox/queries', async () => {
  const { detailEnv } = await import('./leadDetailEnv')
  return { getInboxConversationByLeadId: async () => (detailEnv.conversationId ? { conversationId: detailEnv.conversationId } : null) }
})
vi.mock('@/db/inboxMessages', async () => ({ listConversationMessages: async () => (await import('./leadDetailEnv')).detailEnv.messages }))
vi.mock('@/db/leadFormAnswers', async () => ({ formAnswersForLead: async () => (await import('./leadDetailEnv')).detailEnv.formAnswers }))
vi.mock('@/db/adsCrmOutcomes', async () => ({ getLeadAdAttribution: async () => (await import('./leadDetailEnv')).detailEnv.attribution }))
vi.mock('@/db/adsSnapshots', async () => ({ readCreativeForAd: async () => (await import('./leadDetailEnv')).detailEnv.creative }))
vi.mock('@/lib/facebook/permissions', async () => {
  const { detailEnv } = await import('./leadDetailEnv')
  return {
    ...(await vi.importActual<typeof import('@/lib/facebook/permissions')>('@/lib/facebook/permissions')),
    isFacebookAdsReportingEnabledForAgency: () => detailEnv.adsReporting,
  }
})
vi.mock('@/lib/whatsapp/templates/flag', async () => {
  const { detailEnv } = await import('./leadDetailEnv')
  return { isTemplatesEnabledForAgency: () => detailEnv.templatesEnabled }
})
vi.mock('@/db/whatsappTemplates', async () => ({ listTemplates: async () => (await import('./leadDetailEnv')).detailEnv.templates }))
vi.mock('@/lib/inbox/whatsappOutboundTarget', async () => {
  const { detailEnv } = await import('./leadDetailEnv')
  return { resolveWhatsappOutboundTarget: async () => (detailEnv.reachable ? { ok: true } : { ok: false }) }
})
vi.mock('@/actions/ai/leadIntelligence', async () => ({ getLeadIntelligence: async () => (await import('./leadDetailEnv')).detailEnv.intelligence }))
vi.mock('@/actions/ai/leadIntelligenceRefresh', () => ({ refreshLeadIntelligence: async () => ({ ok: true }) }))
vi.mock('@/actions/leadFollowUp', () => ({ setLeadFollowUp: async () => ({}), clearLeadFollowUp: async () => ({}) }))
vi.mock('@/actions/whatsapp/templates/sendTemplateToLead', () => ({ sendTemplateToLead: async () => ({ ok: true }) }))
// Out of this phase: the Copilot lead context, the deal form (Phase E), the mobile lead detail (Phase F).
vi.mock('@/components/copilot/CopilotLeadContext', () => ({ default: () => null }))
vi.mock('@/components/sales/saleForm/SaleForm', () => ({ default: () => null }))
vi.mock('@/modules/leads/mobile/LeadDetailMobile', () => ({ default: () => null }))

const { SURFACES } = await import('./surfaces')

const saved = { ...process.env }
beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime((await import('./dashboardFixtures')).NOW)
})
afterAll(() => vi.useRealTimers())
afterEach(async () => {
  cleanup()
  process.env = { ...saved }
  const { dashboardEnv, STATS } = await import('./dashboardFixtures')
  Object.assign(dashboardEnv, { mobile: false, v2: true, stats: STATS })
  ;(await import('./leadsEnv')).resetLeadsEnv()
  ;(await import('./leadDetailEnv')).resetDetailEnv()
})

describe('Hebrew-leak gate — completed screens render no untranslated Hebrew', () => {
  for (const surface of SURFACES) {
    test(`${surface.name} (${surface.route})`, async () => {
      process.env.UI_LOCALE_ENABLED = '1'
      process.env.UI_LOCALE_AGENCY_ALLOWLIST = '103'
      process.env.MOBILE_WORKSPACE_ENABLED = '1'
      process.env.MOBILE_WORKSPACE_AGENCY_ALLOWLIST = '103'
      const used = new Set<string>()
      for (const locale of ['en', 'ar'] as const) {
        prefs.userLocale = locale
        const { container } = render(await surface.render(locale))
        expect(findHebrewLeaks(container, surface.allowed, used), `${surface.name} [${locale}]`).toEqual([])
        cleanup()
      }
      const stale = surface.allowed.filter((a) => !used.has(a.text)).map((a) => a.text)
      expect(stale, `${surface.name}: allowances never used — remove them`).toEqual([])
    })
  }

  test('every registered screen renders Hebrew in Hebrew (the gate is not vacuous)', async () => {
    process.env.UI_LOCALE_ENABLED = '1'
    process.env.UI_LOCALE_AGENCY_ALLOWLIST = '103'
    process.env.MOBILE_WORKSPACE_ENABLED = '1'
    process.env.MOBILE_WORKSPACE_AGENCY_ALLOWLIST = '103'
    prefs.userLocale = 'he'
    for (const surface of SURFACES) {
      const { container } = render(await surface.render('he'))
      expect(findHebrewLeaks(container, surface.allowed).length, surface.name).toBeGreaterThan(0)
      cleanup()
    }
  })
})
