import type { ReactNode } from 'react'
import type { UiLocale } from '@/lib/i18n/config'
import { resolveAsync } from './dashboardHarness'
import { ACTIVE, TABS_DEFAULTS, tabsEnv } from './leadTabsEnv'

/**
 * Renders the lead TABS (`/clients/[clientId]/{tasks,tasks/[taskId],files,billing}`)
 * the way the (app) layout does: the interface-language provider, the
 * entitlement state and the session user around the REAL server page (async
 * server components resolved in place). Mocks for their reads live in each
 * test file; `nextDynamicMock` replaces `next/dynamic` there.
 */

type Ent = { hasAccess: boolean; status: string; expiresAt: string | null }

export async function tabsShell(locale: UiLocale | null, node: ReactNode, ent: Ent = ACTIVE) {
  const { I18nProvider } = await import('@/lib/i18n/I18nProvider')
  const { EntitlementProvider } = await import('@/lib/entitlement/EntitlementContext')
  const { UserProvider } = await import('@/lib/hooksNEvents')
  const inner = (
    <EntitlementProvider value={ent}>
      <UserProvider user={tabsEnv.user}>{node}</UserProvider>
    </EntitlementProvider>
  )
  // `null`: no provider at all — the Hebrew baseline renders exactly as before i18n.
  return locale ? <I18nProvider locale={locale}>{inner}</I18nProvider> : inner
}

const params = (clientId = '41', taskId = '2') => Promise.resolve({ clientId, taskId })

export async function tasksPage() {
  const { default: Page } = await import('@/app/(he)/(app)/clients/[clientId]/tasks/page')
  return resolveAsync(await Page({ params: params() }))
}

export async function taskDetailPage() {
  const { default: Page } = await import('@/app/(he)/(app)/clients/[clientId]/tasks/[taskId]/page')
  return resolveAsync(await Page({ params: params() }))
}

export async function filesPage() {
  const { default: Page } = await import('@/app/(he)/(app)/clients/[clientId]/files/page')
  return resolveAsync(await Page({ params: params(), searchParams: Promise.resolve({}) }))
}

export async function billingPage() {
  const { default: Page } = await import('@/app/(he)/(app)/clients/[clientId]/billing/page')
  return resolveAsync(await Page({ params: params() }))
}

/** Run the page's server reads under `overrides`, then restore the defaults other surfaces expect. */
export async function withTabsEnv<T>(overrides: Partial<typeof TABS_DEFAULTS>, build: () => Promise<T>): Promise<T> {
  Object.assign(tabsEnv, TABS_DEFAULTS, overrides)
  try {
    return await build()
  } finally {
    Object.assign(tabsEnv, TABS_DEFAULTS)
  }
}

/**
 * `next/dynamic` for tests: an `ssr: false` import renders nothing (what the
 * server sends), any other import becomes an async component that the
 * harness's `resolveAsync` awaits in place.
 */
export function nextDynamicMock(loader: () => Promise<unknown>, opts?: { ssr?: boolean }) {
  if (opts?.ssr === false) return () => null
  return async function Dynamic(props: Record<string, unknown>) {
    const mod = (await loader()) as { default?: (p: unknown) => ReactNode }
    const C = (mod.default ?? mod) as (p: unknown) => ReactNode
    return <C {...props} />
  }
}
