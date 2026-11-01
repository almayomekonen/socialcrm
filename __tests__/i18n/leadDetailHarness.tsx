import type { ReactNode } from 'react'
import type { UiLocale } from '@/lib/i18n/config'
import { resolveAsync } from './dashboardHarness'
import { ACTIVE, DETAIL_DEFAULTS, detailEnv } from './leadDetailEnv'

/**
 * Renders the lead DETAIL screen the way the (app) layout does: the interface
 * language provider and the entitlement state around the REAL
 * `/clients/[clientId]` layout and summary page (async server components
 * resolved in place). Mocks for their reads live in each test file.
 */

type Ent = { hasAccess: boolean; status: string; expiresAt: string | null }

export async function detailShell(locale: UiLocale, node: ReactNode, ent: Ent = ACTIVE) {
  const { I18nProvider } = await import('@/lib/i18n/I18nProvider')
  const { EntitlementProvider } = await import('@/lib/entitlement/EntitlementContext')
  return (
    <I18nProvider locale={locale}>
      <EntitlementProvider value={ent}>{node}</EntitlementProvider>
    </I18nProvider>
  )
}

export async function detailLayout(children: ReactNode = null, clientId = '41') {
  const { default: Layout } = await import('@/app/(he)/(app)/clients/[clientId]/layout')
  return resolveAsync(await Layout({ children, params: Promise.resolve({ clientId }) }))
}

export async function summaryPage(clientId = '41') {
  const { default: SummaryPage } = await import('@/app/(he)/(app)/clients/[clientId]/summary/page')
  return resolveAsync(await SummaryPage({ params: Promise.resolve({ clientId }), searchParams: Promise.resolve({}) }))
}

/** Run the page's server reads under `overrides`, then restore the defaults other surfaces expect. */
export async function withDetailEnv<T>(overrides: Partial<typeof DETAIL_DEFAULTS>, build: () => Promise<T>): Promise<T> {
  Object.assign(detailEnv, DETAIL_DEFAULTS, overrides)
  try {
    return await build()
  } finally {
    Object.assign(detailEnv, DETAIL_DEFAULTS)
  }
}
