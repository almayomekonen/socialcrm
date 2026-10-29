import type { ReactNode } from 'react'
import type { UiLocale } from '@/lib/i18n/config'
import { resolveAsync } from './dashboardHarness'
import { ACTIVE } from './leadTabsEnv'
import { GLOBAL_DEFAULTS, globalEnv } from './globalTasksFilesEnv'

/**
 * Renders the GLOBAL /tasks and /files pages the way the (app) layout does:
 * the interface-language provider, the entitlement state and the session user
 * around the REAL server page (async server components resolved in place).
 * Mocks for their reads live in each test file; `nextDynamicMock`
 * (leadTabsHarness) replaces `next/dynamic` there.
 */

type Ent = { hasAccess: boolean; status: string; expiresAt: string | null }

export async function globalShell(locale: UiLocale | null, node: ReactNode, ent: Ent = ACTIVE) {
  const { I18nProvider } = await import('@/lib/i18n/I18nProvider')
  const { EntitlementProvider } = await import('@/lib/entitlement/EntitlementContext')
  const { UserProvider } = await import('@/lib/hooksNEvents')
  const inner = (
    <EntitlementProvider value={ent}>
      <UserProvider user={globalEnv.user}>{node}</UserProvider>
    </EntitlementProvider>
  )
  // `null`: no provider at all — the Hebrew baseline renders exactly as before i18n.
  return locale ? <I18nProvider locale={locale}>{inner}</I18nProvider> : inner
}

export async function globalTasksPage(filter?: Record<string, unknown>) {
  const { default: Page } = await import('@/app/(app)/tasks/page')
  const searchParams = Promise.resolve(filter ? { filter: JSON.stringify(filter) } : {})
  return resolveAsync(await Page({ searchParams }))
}

export async function globalFilesPage() {
  const { default: Page } = await import('@/app/(app)/files/page')
  return resolveAsync(await Page())
}

/** Run the page's server reads under `overrides`, then restore the defaults other surfaces expect. */
export async function withGlobalEnv<T>(overrides: Partial<typeof GLOBAL_DEFAULTS>, build: () => Promise<T>): Promise<T> {
  Object.assign(globalEnv, GLOBAL_DEFAULTS, overrides)
  try {
    return await build()
  } finally {
    Object.assign(globalEnv, GLOBAL_DEFAULTS)
  }
}
