import { vi } from 'vitest'
import { ALL_USERS, PERM_TEAMS, PERM_USERS, dealsEnv } from './dealsEnv'

/**
 * Module doubles behind every /deals, /sum_sales and /promotion i18n test
 * (Phase E2). The `vi.mock` calls live in each test file (they are hoisted per
 * file); each returns the matching factory below. Only I/O is replaced — db
 * reads, server actions, flags, toasts, navigation. Pages, components and label
 * producers are the REAL ones.
 */
export const dealsSpies = {
  prefs: { userLocale: null as string | null },
  toasts: [] as unknown[][],
  calls: [] as unknown[][],
  pushes: [] as string[],
  replaces: [] as string[],
  redirects: [] as string[],
  refreshes: 0,
  /** Server-action answers the interaction tests steer. */
  uploadDealData: vi.fn(async (..._a: unknown[]): Promise<Record<string, unknown>> => ({ data: [], wrongData: [] })),
  importDeals: vi.fn(async (..._a: unknown[]): Promise<Record<string, unknown>> => ({ imported: 0, duplicates: 0, createdLeads: 0, rejected: [] })),
  deleteManyDeals: vi.fn(async (..._a: unknown[]): Promise<Record<string, unknown>> => ({ deleted: 0, skipped: 0 })),
  deleteDeals: vi.fn(async (..._a: unknown[]): Promise<number> => 1),
  isPrdctsExists: vi.fn(async (..._a: unknown[]): Promise<string | null> => null),
  insertSale: vi.fn(async (..._a: unknown[]): Promise<unknown> => ({})),
  getLeadByIdNum: vi.fn(async (..._a: unknown[]): Promise<unknown> => null),
  upsertLead: vi.fn(async (..._a: unknown[]): Promise<Record<string, unknown>> => ({ id: 90, details: 'ליד חדש' })),
  disconnectAds: vi.fn(async () => {}),
  getAdPreview: vi.fn(async (..._a: unknown[]): Promise<Record<string, unknown>> => ({ ok: false })),
}

export function resetDealsSpies() {
  dealsSpies.prefs.userLocale = null
  dealsSpies.toasts.length = 0
  dealsSpies.calls.length = 0
  dealsSpies.pushes.length = 0
  dealsSpies.replaces.length = 0
  dealsSpies.redirects.length = 0
  dealsSpies.refreshes = 0
  dealsSpies.uploadDealData.mockReset().mockImplementation(async () => ({ data: [], wrongData: [] }))
  dealsSpies.importDeals.mockReset().mockImplementation(async () => ({ imported: 0, duplicates: 0, createdLeads: 0, rejected: [] }))
  dealsSpies.deleteManyDeals.mockReset().mockImplementation(async () => ({ deleted: 0, skipped: 0 }))
  dealsSpies.deleteDeals.mockReset().mockImplementation(async () => 1)
  dealsSpies.isPrdctsExists.mockReset().mockImplementation(async () => null)
  dealsSpies.insertSale.mockReset().mockImplementation(async () => ({}))
  dealsSpies.getLeadByIdNum.mockReset().mockImplementation(async () => null)
  dealsSpies.upsertLead.mockReset().mockImplementation(async () => ({ id: 90, details: 'ליד חדש' }))
  dealsSpies.disconnectAds.mockReset().mockImplementation(async () => {})
  dealsSpies.getAdPreview.mockReset().mockImplementation(async () => ({ ok: false }))
}

const record =
  (name: string, result: unknown = undefined) =>
  async (...a: unknown[]) => (dealsSpies.calls.push([name, ...a]), result)

export const navigationModule = () => ({
  usePathname: () => dealsEnv.pathname,
  useRouter: () => ({
    push: (to: string) => dealsSpies.pushes.push(to),
    replace: (to: string) => dealsSpies.replaces.push(to),
    refresh: () => (dealsSpies.refreshes += 1),
  }),
  useSearchParams: () => new URLSearchParams(dealsEnv.search),
  redirect: (to: string) => {
    dealsSpies.redirects.push(to)
  },
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
})

/** A knex-like builder: every call chains; nothing is ever executed. */
export function fakeSql(): any {
  const target = () => {}
  const proxy: any = new Proxy(target, {
    get: (_t, prop) => {
      if (prop === 'toSQL') return () => ({ sql: 'select 1', bindings: [] })
      if (prop === 'then') return undefined
      return () => proxy
    },
    apply: () => proxy,
  })
  return proxy
}

export const configDbModule = () => ({ db: fakeSql() })

export const filterDbModule = () => ({
  getPerms: async () => ({ gotPermIds: dealsEnv.gotPermIds, gotPermUsers: PERM_USERS, gotPermTeams: PERM_TEAMS, gavePermUsers: [] }),
  getPermsAndFilter: async ({ filter, user }: { filter?: string; user: { role: string } }) => {
    const rawFilter = filter ? JSON.parse(filter) : {}
    // Same default as the real one: an admin with no date range sees this month.
    if ((user.role === 'ADMIN' || user.role === 'GM') && !rawFilter.dateRange) rawFilter.dateRange = 'החודש הנוכחי'
    dealsEnv.lastFilter = structuredClone(rawFilter)
    return {
      rawFilter,
      sqlFilter: { ...rawFilter, sql: fakeSql(), userIds: [] },
      gotPermIds: dealsEnv.gotPermIds,
      gotPermUsers: PERM_USERS,
      gotPermTeams: PERM_TEAMS,
      allPermUsers: PERM_USERS,
    }
  },
})

export const resolveActiveFilterModule = () => ({
  resolveActiveFilter: async (_section: string, _userId: unknown, urlFilter: string | undefined) => urlFilter ?? dealsEnv.storedFilter,
})

export const salesTblDbModule = () => ({
  getDealTableData: async () => ({ tblData: dealsEnv.deals, count: dealsEnv.count, revenue: dealsEnv.revenue, sqlExport: 'signed-export' }),
  isDealsSystemEmpty: async () => dealsEnv.systemEmpty,
  getTablePref: async () => ({}),
})

export const usersNTeamsModule = () => ({
  getUsers: async () => ALL_USERS,
  getTeamNUserNames: async () => ({ teamNames: ['צוות צפון'], userNames: ['רון נציג', 'מיכל שותפה'] }),
  getDefaultSettings: async () => ({}),
})

export const sumSalesDbModule = () => ({
  getGoalsAndTotals: async () => dealsEnv.goals,
  getSaleStats: async () => dealsEnv.saleStats,
  getSumBranchesByUser: async () => dealsEnv.byUser,
  getSumBranchesByMonths: async () => dealsEnv.byMonth,
  getSumBranchesByTeams: async () => dealsEnv.byTeam,
  getSumBranchesByCompany: async () => dealsEnv.byCompany,
  addNotIncludedUsers: async ({ res }: { res: unknown[] }) => res,
})

export const sumPieModule = async () => {
  const { formatPieData } = await vi.importActual<typeof import('@/db/sum_pie')>('@/db/sum_pie')
  return { formatPieData, getPieData: async () => formatPieData(dealsEnv.pieRows as never) }
}

export const promosDbModule = () => ({
  getPromos: async () => dealsEnv.promos,
  getPromosByUserId: async () => dealsEnv.promos,
  getPromo: async () => (dealsEnv.promo ? structuredClone(dealsEnv.promo) : null),
  getPromoTotals: async () => structuredClone(dealsEnv.promoTotals),
  getTeamsPromoTotals: async () => structuredClone(dealsEnv.teamPromoTotals),
})

export const permissionsModule = () => ({ isFacebookAdsReportingEnabledForAgency: () => dealsEnv.adsEnabled })

export const salesTblActionsModule = () => ({
  getDealDataToExport: record('getDealDataToExport', []),
  addFavDeals: record('addFavDeals'),
  removeFavDeals: record('removeFavDeals'),
  removeFavDeal: record('removeFavDeal'),
  deleteDeals: async (...a: unknown[]) => (dealsSpies.calls.push(['deleteDeals', ...a]), dealsSpies.deleteDeals(...a)),
  deleteManyDeals: async (...a: unknown[]) => (dealsSpies.calls.push(['deleteManyDeals', ...a]), dealsSpies.deleteManyDeals(...a)),
  deleteDeal: record('deleteDeal', { ok: true }),
  updateDealStatus: record('updateDealStatus'),
  updateManyDealStatus: record('updateManyDealStatus'),
})

export const dealImportModule = () => ({
  uploadDealData: async (...a: unknown[]) => (dealsSpies.calls.push(['uploadDealData']), dealsSpies.uploadDealData(...a)),
  importDeals: async (...a: unknown[]) => (dealsSpies.calls.push(['importDeals', ...a]), dealsSpies.importDeals(...a)),
  revalidateDealImport: record('revalidateDealImport'),
})

export const saleFormActionsModule = () => ({
  isPrdctsExists: async (...a: unknown[]) => (dealsSpies.calls.push(['isPrdctsExists', ...a]), dealsSpies.isPrdctsExists(...a)),
  insertSale: async (...a: unknown[]) => (dealsSpies.calls.push(['insertSale', ...a]), dealsSpies.insertSale(...a)),
})

export const clientsActionsModule = () => ({
  searchContacts: async () => [{ id: 41, details: 'מירב כהן 1' }],
  getLeadByIdNum: async (...a: unknown[]) => dealsSpies.getLeadByIdNum(...a),
  upsertLead: async (...a: unknown[]) => (dealsSpies.calls.push(['upsertLead', ...a]), dealsSpies.upsertLead(...a)),
})

export const filterActionsModule = () => ({ addSavedFilters: record('addSavedFilters') })
export const globalActionsModule = () => ({ saveTblPref: record('saveTblPref') })
export const toastModule = () => ({
  toast: (...args: unknown[]) => dealsSpies.toasts.push(args),
  proToast: (...args: unknown[]) => dealsSpies.toasts.push(['pro', ...args]),
})
export const adsActionsModule = () => ({
  disconnectAdsReporting: async () => (dealsSpies.calls.push(['disconnectAdsReporting']), dealsSpies.disconnectAds()),
  getAdPreview: async (...a: unknown[]) => dealsSpies.getAdPreview(...a),
})
