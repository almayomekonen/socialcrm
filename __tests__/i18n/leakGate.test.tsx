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
vi.mock('@/modules/inbox/awareness/AwarenessContext', () => ({
  useAwarenessCount: () => null,
  // The phone inbox list and read marker push the unread count (mobile Phase D surfaces).
  useAwareness: () => ({ whatsappUnread: null, setCount: () => {}, mergeAwareness: () => {} }),
}))
vi.mock('@/components/notifications/NotificationBell', () => ({ default: () => null }))
vi.mock('@/components/education/HelpTrigger', () => ({ default: () => null }))
vi.mock('@/db/auth', async () => ({ getUser: async () => (await import('./surfaces')).FIXTURE_USER }))
vi.mock('@/db/uiLocale', () => ({ getUiLocalePrefs: async () => ({ userLocale: prefs.userLocale, agencyLocale: null }) }))
vi.mock('@/lib/device', async () => {
  const f = await import('./dashboardFixtures')
  // The Messenger / Comments phone branches (mobile Phase D) read their fixtures' `mobile` flag; false by default.
  const mc = (await import('./messengerCommentsMocks')).deviceModule()
  return { isMobileRequest: async () => f.dashboardEnv.mobile, isMobileWorkspaceRequest: mc.isMobileWorkspaceRequest, getInAppBrowser: async () => null }
})
vi.mock('@/lib/access/productAccess', async () => {
  const { detailEnv } = await import('./leadDetailEnv')
  const { billEnv } = await import('./billingEnv') // the new-invoice route lock (Phase E3)
  return { getAgencyProductAccess: async () => ({ hasAccess: detailEnv.hasAccess && billEnv.hasAccess }) }
})
// /dashboard reads (I/O only; every producer and component runs for real).
// `gavePermUsers`: the global /tasks page (Phase E1) also lists the reps who gave permission.
// `getPermsAndFilter`: /deals and /sum_sales (Phase E2).
vi.mock('@/db/filter', async () => ({ getPerms: async () => ({ ...(await import('./leadsEnv')).LEADS_PAGE_PERMS, gavePermUsers: [] }), getPermsAndFilter: (await import('./dealsMocks')).filterDbModule().getPermsAndFilter }))
vi.mock('@/db/clients', async () => (await import('./leakGateMocks')).clientsDbModule())
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
  return {
    getFacebookConnectionState: async () => leadsEnv.meta,
    // Pure (the Messenger / Comments pages read their Pages' grants with it).
    parseGrantedScopes: (await vi.importActual<typeof import('@/db/facebook')>('@/db/facebook')).parseGrantedScopes,
  }
})
// /leads and /clients reads (I/O only; the page, banners, table and producers run for real).
vi.mock('@/db/usersNTeams', async () => ({
  getDefaultSettings: async () => ({}),
  getUsers: async () => (await import('./leadsEnv')).USERS,
  getUserNameById: async () => (await import('./leadDetailEnv')).detailEnv.handlerName,
  getTeamNUserNames: (await import('./dealsMocks')).usersNTeamsModule().getTeamNUserNames, // /promotion/[id] (Phase E2)
}))
vi.mock('@/lib/quota', async () => {
  const { leadsEnv } = await import('./leadsEnv')
  return { getQuotaStatus: async () => ({ overQuotaCount: leadsEnv.overQuota }) }
})
vi.mock('@/db/automations/connectionDelivery', async () => {
  const { leadsEnv } = await import('./leadsEnv')
  return { deliveryFacts: async () => leadsEnv.intakeFacts }
})
vi.mock('@/actions/clients', async () => (await import('./leakGateMocks')).clientsActionsModule())
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
vi.mock('@/db/tasks', async () => (await import('./leakGateMocks')).tasksDbModule())
vi.mock('@/modules/inbox/queries', async () => {
  const { detailEnv } = await import('./leadDetailEnv')
  return {
    // The inbox list reads (Phase D), from the inbox fixtures.
    ...(await (await import('./inboxMocks')).queriesModule()),
    getInboxConversationByLeadId: async () => (detailEnv.conversationId ? { conversationId: detailEnv.conversationId } : null),
  }
})
vi.mock('@/db/inboxMessages', async () => {
  const { detailEnv } = await import('./leadDetailEnv')
  const { inboxEnv } = await import('./inboxEnv')
  // The inbox thread while an inbox page is being built; the lead summary's preview otherwise.
  return { listConversationMessages: async () => (inboxEnv.active ? structuredClone(inboxEnv.messages) : detailEnv.messages) }
})
vi.mock('@/db/leadFormAnswers', async () => ({ formAnswersForLead: async () => (await import('./leadDetailEnv')).detailEnv.formAnswers }))
vi.mock('@/db/adsCrmOutcomes', async () => ({ getLeadAdAttribution: async () => (await import('./leadDetailEnv')).detailEnv.attribution }))
// `readSnapshot` / `writeSnapshot`: the ads report's (empty) snapshot cache (Phase E2).
vi.mock('@/db/adsSnapshots', async () => ({ readCreativeForAd: async () => (await import('./leadDetailEnv')).detailEnv.creative, readSnapshot: async () => null, writeSnapshot: async () => {} }))
vi.mock('@/lib/facebook/permissions', async () => (await import('./leakGateMocks')).facebookPermissionsModule())
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
vi.mock('@/modules/leads/mobile/LeadDetailMobile', () => ({ default: () => null }))

// /clients/[clientId]/{tasks,files,billing} reads (I/O only; the pages, tables, Drive section and list run for real).
vi.mock('next/dynamic', async () => ({ default: (await import('./leadTabsHarness')).nextDynamicMock }))
vi.mock('@/db/files', async () => ({
  getFilesByClientId: async () => (await import('./leadTabsEnv')).tabsEnv.files,
  // Global /files (Phase E1).
  getFiles: async () => (await import('./globalTasksFilesEnv')).globalEnv.files,
}))
// /calendar reads and actions (Phase E1; I/O only — the page, view and producers run for real).
vi.mock('@/db/googleCalendarConnections', async () => ({
  getCalendarConnectionByUserId: async () => (await import('./calendarEnv')).calEnv.connection,
}))
vi.mock('@/actions/calendar', async () => (await import('./calendarEnv')).calendarActionsModule())
vi.mock('@/actions/tasks', () => ({ addTask: async () => 1, addTaskFromTmplt: async () => 1, updateFullTask: async () => {}, updateFullTaskTmplt: async () => {}, deleteTask: async () => {} }))
vi.mock('@/actions/files', () => ({ deleteFile: async () => {}, addFilesToTask: async () => {}, addFiles: async () => [], getPresigned: async () => [] }))
vi.mock('@/actions/leadDriveFiles', async () => ({
  listLeadDriveAttachments: async () => (await import('./leadTabsEnv')).tabsEnv.attachments,
  attachDriveFile: async () => ({ ok: true }),
  detachDriveFile: async () => ({ ok: true }),
}))
vi.mock('@/actions/leadDriveFilesSearch', async () => ({
  fetchSuggestedDriveFiles: async () => (await import('./leadTabsEnv')).tabsEnv.suggestions,
  searchDriveForLead: async () => [],
}))
vi.mock('@/lib/integrations/google/picker/useDrivePicker', () => ({ useDrivePicker: () => ({ status: 'idle', openPicker: () => {} }) }))
vi.mock('@/config/db', async () => (await import('./leakGateMocks')).configDbModule())
vi.mock('@/db/billing/invoices', async () => ({
  ...(await import('./billingMocks')).invoicesDbModule(), // the invoice screens (Phase E3)
  listInvoicesForLead: async () => (await import('./leadTabsEnv')).tabsEnv.invoices,
}))
// The invoice editors, the issued view and the lead picker (Phase E3; I/O only).
vi.mock('@/db/billing/profiles', async () => (await import('./billingMocks')).profilesDbModule())
vi.mock('@/db/billing/documents', async () => (await import('./billingMocks')).documentsDbModule())
vi.mock('@/db/billing/events', async () => (await import('./billingMocks')).eventsDbModule())
vi.mock('@/db/billing/taxRates', async () => (await import('./billingMocks')).taxRatesDbModule())
vi.mock('@/actions/billing/drafts', async () => (await import('./billingMocks')).draftsActionsModule())
vi.mock('@/actions/billing/issue', async () => (await import('./billingMocks')).issueActionsModule())
vi.mock('@/actions/billing/issuer', async () => (await import('./billingMocks')).issuerActionsModule())
vi.mock('@/actions/billing/render', async () => (await import('./billingMocks')).renderActionsModule())
vi.mock('@/actions/billing/duplicate', async () => (await import('./billingMocks')).duplicateActionsModule())
vi.mock('@/actions/billing/send', async () => (await import('./billingMocks')).sendActionsModule())
vi.mock('@/actions/billing/documentStatus', async () => (await import('./billingMocks')).documentStatusModule())

// /inbox reads and actions (I/O only; the page, list, thread, composer, ownership line and producers run for real).
vi.mock('next/cache', async () => (await import('./inboxMocks')).cacheModule())
vi.mock('@/lib/flags/inboxFlags', () => ({ isInboxDeltaSyncEnabled: () => false, getInboxRefreshIntervalMs: () => null }))
vi.mock('@/modules/messenger/queries', async () => (await import('./messengerCommentsMocks')).messengerQueriesModule())
vi.mock('@/modules/inbox/actions', async () => (await import('./inboxMocks')).inboxActionsModule())
vi.mock('@/lib/inbox/whatsappComposerContext', async () => {
  const { inboxEnv } = await import('./inboxEnv')
  return { loadWhatsappComposerContext: async () => inboxEnv.composer }
})
vi.mock('@/db/conversationAiState', async () => (await import('./inboxMocks')).aiStateModule())
vi.mock('@/db/conversationIntelligence', async () => (await import('./inboxMocks')).conversationIntelligenceModule())
vi.mock('@/db/autoResponseSettings', async () => (await import('./inboxMocks')).autoResponseSettingsModule())
vi.mock('@/db/questionnaireSessions', async () => (await import('./inboxMocks')).questionnaireSessionsModule())
vi.mock('@/lib/inbox/autoresponse/reliability/entitlement', async () => (await import('./inboxMocks')).replyEntitlementModule())
vi.mock('@/actions/inbox/agentOwnership', async () => (await import('./inboxMocks')).ownershipActionsModule())
vi.mock('@/actions/whatsapp/promoteConversationToLead', async () => (await import('./inboxMocks')).promoteActionsModule())
vi.mock('@/actions/whatsapp/markConversationPersonal', () => ({ markConversationPersonal: async () => ({ ok: true }) }))
vi.mock('@/actions/whatsapp/sendWhatsappReply', () => ({ sendWhatsappReply: async () => ({ ok: true }) }))
vi.mock('@/actions/ai/whatsappReplyDraft', () => ({ generateWhatsappReplyDraft: async () => ({ ok: true, message: '' }) }))
vi.mock('@/actions/analytics/recordOperatorTakeEvent', () => ({ recordOperatorTakeEvent: async () => {} }))
vi.mock('@/modules/leads/contactEvents', () => ({ contactClicked: () => {}, contactSucceeded: () => {} }))

// /inbox/messenger and /inbox/comments reads and actions (I/O only; the pages, threads, feed and producers run for real).
vi.mock('next/server', async () => ({ ...(await vi.importActual<typeof import('next/server')>('next/server')), after: () => {} }))
vi.mock('@/lib/facebook/comments/capability', async () => (await import('./messengerCommentsMocks')).capabilityModule())
vi.mock('@/db/messengerSavedReplies', async () => (await import('./messengerCommentsMocks')).savedRepliesModule())
vi.mock('@/lib/facebook/messenger/deliveryCheck', async () => (await import('./messengerCommentsMocks')).deliveryModule())
vi.mock('@/lib/facebook/messenger/profile', async () => (await import('./messengerCommentsMocks')).profileModule())
vi.mock('@/modules/messenger/actions', async () => (await import('./messengerCommentsMocks')).messengerActionsModule())
vi.mock('@/modules/messenger/leadActions', async () => (await import('./messengerCommentsMocks')).messengerLeadActionsModule())
vi.mock('@/modules/messenger/profileActions', async () => (await import('./messengerCommentsMocks')).messengerProfileActionsModule())
vi.mock('@/modules/facebookComments/queries', async () => (await import('./messengerCommentsMocks')).commentsQueriesModule())
vi.mock('@/modules/facebookComments/feed', async () => (await import('./messengerCommentsMocks')).feedModule())
vi.mock('@/lib/facebook/comments/enrich', async () => (await import('./messengerCommentsMocks')).enrichModule())
vi.mock('@/modules/facebookComments/actions', async () => (await import('./messengerCommentsMocks')).commentsActionsModule())
vi.mock('@/modules/facebookComments/replyActions', async () => (await import('./messengerCommentsMocks')).replyActionsModule())
vi.mock('@/modules/facebookComments/listActions', async () => (await import('./messengerCommentsMocks')).listActionsModule())

// /deals, /sum_sales, /promotion reads and actions (Phase E2; I/O only — pages, tables, charts and producers run for real).
vi.mock('@/lib/filter/resolveActiveFilter', async () => (await import('./dealsMocks')).resolveActiveFilterModule())
vi.mock('@/db/salesTbl', async () => (await import('./dealsMocks')).salesTblDbModule())
vi.mock('@/db/sumSales', async () => (await import('./dealsMocks')).sumSalesDbModule())
vi.mock('@/db/sum_pie', async () => (await import('./dealsMocks')).sumPieModule())
vi.mock('@/db/promos', async () => (await import('./dealsMocks')).promosDbModule())
vi.mock('@/actions/salesTbl', async () => (await import('./dealsMocks')).salesTblActionsModule())
vi.mock('@/actions/dealImport', async () => (await import('./dealsMocks')).dealImportModule())
vi.mock('@/actions/saleForm', async () => (await import('./dealsMocks')).saleFormActionsModule())
vi.mock('@/actions/filter', async () => (await import('./dealsMocks')).filterActionsModule())
vi.mock('@/modules/adsReporting/actions', async () => (await import('./dealsMocks')).adsActionsModule())
vi.mock('@/db/facebookAds', async () => (await import('./dealsMocks')).adsDbModule())
vi.mock('@/lib/facebook/ads/cached', async () => (await import('./dealsMocks')).adsCachedModule())
vi.mock('@/lib/facebook/ads/insights', async () => (await import('./dealsMocks')).adsInsightsModule())
vi.mock('@/lib/facebook/ads/report', async () => (await import('./dealsMocks')).adsReportModule())
vi.mock('@/lib/facebook/ads/breakdown', async () => (await import('./dealsMocks')).adsBreakdownModule())
vi.mock('@/lib/facebook/ads/intelligence', async () => (await import('./dealsMocks')).adsIntelligenceModule())

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
  ;(await import('./leadTabsEnv')).resetTabsEnv()
  ;(await import('./inboxEnv')).resetInboxEnv()
  ;(await import('./messengerCommentsEnv')).resetMessengerCommentsEnv()
  ;(await import('./globalTasksFilesEnv')).resetGlobalEnv()
  ;(await import('./calendarEnv')).resetCalEnv()
  ;(await import('./dealsEnv')).resetDealsEnv(), (await import('./adsEnv')).resetAdsEnv()
  ;(await import('./billingEnv')).resetBillEnv()
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
