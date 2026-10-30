import { vi } from 'vitest'

/**
 * `vi.mock` factories of the leak gate (leakGate.test.tsx), moved out of the
 * test file so it stays under the 350-line limit. Bodies are unchanged; the
 * `vi.mock` calls (hoisted per file) stay in the test file.
 */

export async function clientsDbModule() {
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
    // Lead tabs (the add-task form on the global page only).
    getLeadsByRep: async () => [],
  }
}

export const clientsActionsModule = () => ({
  fetchLeadsSince: async () => [], searchContacts: async () => [], searchLeads: async () => [], getLeadById: async () => null,
  updateLead: async () => ({ ok: true }), deleteLead: async () => ({ ok: true }),
  deleteManyLeads: async () => ({ deletedCount: 0, blockedCount: 0, blockedLeads: [] }),
  assignLeadsToRep: async () => ({ assignedCount: 0, skippedCount: 0 }), transferLeadToRep: async () => ({ ok: true }),
  getLeadByIdNum: async () => null, upsertLead: async () => ({ ok: true }), addLeads: async () => ({ inserted: 0 }),
  importLeadsFromCsv: async () => ({ inserted: 0 }), uploadLeadData: async () => ({}), upsertLeadList: async () => ({}), deleteLeadList: async () => ({}),
})

export async function tasksDbModule() {
  const { detailEnv } = await import('./leadDetailEnv')
  const { tabsEnv } = await import('./leadTabsEnv')
  return {
    get5TasksByClientId: async () => detailEnv.tasks,
    // Lead tabs.
    getTasksTbl: async () => tabsEnv.tasks,
    getTaskTmplts: async () => tabsEnv.taskTmplts,
    getTaskById: async () => (tabsEnv.taskDetail ? structuredClone(tabsEnv.taskDetail) : undefined),
    getTasksByClientId: async () => [{ id: 2, title: 'שיחת המשך' }],
    // Global /tasks (Phase E1).
    getTasks: async () => (await import('./globalTasksFilesEnv')).globalEnv.tasks,
  }
}

export async function facebookPermissionsModule() {
  const { detailEnv } = await import('./leadDetailEnv')
  const { messengerEnv, commentsEnv } = await import('./messengerCommentsEnv')
  const deals = await import('./dealsEnv')
  return {
    ...(await vi.importActual<typeof import('@/lib/facebook/permissions')>('@/lib/facebook/permissions')),
    // The lead page's ad line; the /sum_sales ads tab and page (Phase E2) read the deals fixtures' flag.
    isFacebookAdsReportingEnabledForAgency: () => detailEnv.adsReporting || (deals.dealsEnv.pathname.startsWith('/sum_sales') && deals.dealsEnv.adsEnabled),
    // Messenger is on by default (the inbox fixtures); the Messenger/Comments surfaces vary both.
    isFacebookMessengerEnabledForAgency: () => messengerEnv.enabled,
    isFacebookCommentRepliesEnabledForAgency: () => commentsEnv.repliesEnabled,
  }
}

export async function configDbModule() {
  const { tabsEnv } = await import('./leadTabsEnv')
  // `select` is the Messenger / Comments pages' facebook_pages read (their fixtures).
  const mc = (await import('./messengerCommentsMocks')).dbModule().db()
  const q = { where: () => q, whereIn: () => q, first: async () => (tabsEnv.leadFound ? { id: 41 } : undefined), select: mc.select }
  const chain = (await import('./dealsMocks')).fakeSql() // /promotion/[id] builds an (unexecuted) query on `db` itself
  // The billing pages (Phase E3) read through their own fixtures while a billing surface is built.
  const { billEnv } = await import('./billingEnv')
  const bill = (await import('./billingMocks')).configDbModule().db
  return { db: new Proxy((table: string) => (billEnv.active ? bill(table) : q), { get: (_t, prop) => chain[prop] }) }
}

// ── Phase E4: modules the user settings pages share with earlier surfaces ──
// While a settings surface is being built (`setEnv.active`), these answer from
// the settings fixtures; otherwise exactly as before.

export async function authModule() {
  const { setEnv } = await import('./settingsEnv')
  const { FIXTURE_USER } = await import('./surfaces')
  const s = (await import('./settingsMocks')).authModule()
  return { getUser: async () => (setEnv.active ? setEnv.user : FIXTURE_USER), decrypt: s.decrypt }
}

export async function productAccessModule() {
  const { detailEnv } = await import('./leadDetailEnv')
  const { billEnv } = await import('./billingEnv') // the new-invoice route lock (Phase E3)
  const { setEnv } = await import('./settingsEnv')
  return { getAgencyProductAccess: async () => ({ hasAccess: setEnv.active ? setEnv.hasAccess : detailEnv.hasAccess && billEnv.hasAccess }) }
}

export async function facebookDbModule() {
  const { leadsEnv } = await import('./leadsEnv')
  return {
    getFacebookConnectionState: async () => leadsEnv.meta,
    getFacebookCommentTextCapability: async () => ({ needsReconnect: false }),
    // Pure (the Messenger / Comments pages read their Pages' grants with it).
    parseGrantedScopes: (await vi.importActual<typeof import('@/db/facebook')>('@/db/facebook')).parseGrantedScopes,
  }
}

export async function usersNTeamsDbModule() {
  const { setEnv } = await import('./settingsEnv')
  const s = (await import('./settingsMocks')).usersNTeamsDbModule()
  const leadsUsers = (await import('./leadsEnv')).USERS
  return {
    getDefaultSettings: async () => (setEnv.active ? s.getDefaultSettings() : {}),
    getUsers: async () => (setEnv.active ? s.getUsers() : leadsUsers),
    getUserNameById: async () => (await import('./leadDetailEnv')).detailEnv.handlerName,
    getTeamNUserNames: (await import('./dealsMocks')).usersNTeamsModule().getTeamNUserNames, // /promotion/[id] (Phase E2)
    getFullUser: s.getFullUser,
    getExtUsersCreatedByUser: s.getExtUsersCreatedByUser,
  }
}

export async function quotaModule() {
  const { leadsEnv } = await import('./leadsEnv')
  return { getQuotaStatus: async () => ({ overQuotaCount: leadsEnv.overQuota }), getAgencyPlan: (await import('./settingsMocks')).quotaModule().getAgencyPlan }
}

export async function whatsappDbModule() {
  return { getWhatsappConnectionState: async () => ({ connected: true }), getWhatsappConnectionForAgency: (await import('./settingsMocks')).whatsappDbModule().getWhatsappConnectionForAgency }
}

export async function templatesFlagModule() {
  const { detailEnv } = await import('./leadDetailEnv')
  const { setEnv } = await import('./settingsEnv')
  return { isTemplatesEnabledForAgency: () => (setEnv.active ? setEnv.templatesEnabled : detailEnv.templatesEnabled) }
}

export async function whatsappTemplatesModule() {
  const { detailEnv } = await import('./leadDetailEnv')
  const { setEnv } = await import('./settingsEnv')
  const s = (await import('./settingsMocks')).templatesDbModule()
  return { listTemplates: async () => (setEnv.active ? s.listTemplates() : detailEnv.templates), countByStatus: s.countByStatus }
}

/** `@/config/db`: the settings pages' own tables while one is built, the earlier surfaces' answers otherwise. */
export async function configDbModuleWithSettings() {
  const base = (await configDbModule()).db as unknown as ((table: string) => unknown) & Record<string, unknown>
  const { setEnv } = await import('./settingsEnv')
  const settings = (await import('./settingsMocks')).configDbModule().db
  return { db: new Proxy((table: string) => (setEnv.active ? settings(table) : base(table)), { get: (_t, prop) => base[prop as string] }) }
}

/** `@/db/googleCalendarConnections`: the calendar fixtures (Phase E1), or the settings fixture while a settings page is built. */
export async function calendarConnModule() {
  const { setEnv } = await import('./settingsEnv')
  const { calEnv } = await import('./calendarEnv')
  return { getCalendarConnectionByUserId: async () => (setEnv.active ? structuredClone(setEnv.calendar) : calEnv.connection) }
}
