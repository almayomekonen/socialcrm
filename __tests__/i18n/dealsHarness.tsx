import type { ReactNode } from 'react'
import type { UiLocale } from '@/lib/i18n/config'
import { resolveAsync } from './dashboardHarness'
import { ACTIVE } from './leadTabsEnv'
import { DEALS_DEFAULTS, dealsEnv } from './dealsEnv'

/**
 * Renders the /deals, /sum_sales and /promotion pages the way the (app) layout
 * does: the interface-language provider, the entitlement state and the session
 * user around the REAL server page (async server components resolved in place).
 * Mocks for their reads come from dealsMocks.ts (declared in each test file);
 * `nextDynamicMock` (leadTabsHarness) replaces `next/dynamic` there.
 */

type Ent = { hasAccess: boolean; status: string; expiresAt: string | null }

export async function dealsShell(locale: UiLocale | null, node: ReactNode, ent: Ent = ACTIVE) {
  const { I18nProvider } = await import('@/lib/i18n/I18nProvider')
  const { EntitlementProvider } = await import('@/lib/entitlement/EntitlementContext')
  const { UserProvider, PosProvider } = await import('@/lib/hooksNEvents')
  const inner = (
    <EntitlementProvider value={ent}>
      <UserProvider user={dealsEnv.user}>
        <PosProvider>{node}</PosProvider>
      </UserProvider>
    </EntitlementProvider>
  )
  // `null`: no provider at all — the Hebrew baseline renders exactly as before i18n.
  return locale ? <I18nProvider locale={locale}>{inner}</I18nProvider> : inner
}

const sp = (filter?: Record<string, unknown>, extra: Record<string, string> = {}) =>
  Promise.resolve({ ...(filter ? { filter: JSON.stringify(filter) } : {}), ...extra })

export async function dealsPage(filter?: Record<string, unknown>, extra: Record<string, string> = {}) {
  const { default: Page } = await import('@/app/(he)/(app)/deals/page')
  return resolveAsync(await Page({ searchParams: sp(filter, extra) }))
}

/** The performance layout (sub-nav) around one of its pages. */
export async function perfLayout(children: ReactNode) {
  const { default: Layout } = await import('@/app/(he)/(app)/sum_sales/layout')
  return resolveAsync(await Layout({ children }))
}

type PerfPage = 'overview' | 'agents' | 'months' | 'teams' | 'companies'
const PERF_MODULES: Record<PerfPage, () => Promise<{ default: (p: any) => Promise<ReactNode> }>> = {
  overview: () => import('@/app/(he)/(app)/sum_sales/page'),
  agents: () => import('@/app/(he)/(app)/sum_sales/agents/page'),
  months: () => import('@/app/(he)/(app)/sum_sales/months/page'),
  teams: () => import('@/app/(he)/(app)/sum_sales/teams/page'),
  companies: () => import('@/app/(he)/(app)/sum_sales/companies/page'),
}

export async function perfPage(which: PerfPage, filter?: Record<string, unknown>) {
  const { default: Page } = await PERF_MODULES[which]()
  return resolveAsync(await Page({ searchParams: sp(filter) }))
}

export async function promotionListPage() {
  const { default: Page } = await import('@/app/(he)/(app)/promotion/page')
  return resolveAsync(await Page())
}

export async function promotionPage(id = '1') {
  const { default: Page } = await import('@/app/(he)/(app)/promotion/[id]/page')
  return resolveAsync(await Page({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) }))
}

/** Run the page's server reads under `overrides`, then restore the defaults other surfaces expect. */
export async function withDealsEnv<T>(overrides: Partial<typeof DEALS_DEFAULTS>, build: () => Promise<T>): Promise<T> {
  Object.assign(dealsEnv, DEALS_DEFAULTS, overrides)
  try {
    return await build()
  } finally {
    Object.assign(dealsEnv, DEALS_DEFAULTS)
  }
}
