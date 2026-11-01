import type { ReactNode } from 'react'
import type { UiLocale } from '@/lib/i18n/config'
import { AUTOMATIONS_DEFAULTS, automationsEnv } from './automationsEnv'
import { ACTIVE, EXPIRED, resolveServer } from './adminHarness'

/**
 * Renders the automations screens (Phase E5b) the way the (app) layout does:
 * the interface-language provider, the entitlement state and the session user
 * around the REAL server page, inside the REAL (admin_settings) layout (async
 * server components awaited in place, see adminHarness). The website
 * connectors are the REAL `WebsiteConnection` section of Settings →
 * Integrations. Mocks live in each test file (factories in automationsMocks.ts).
 */
export { ACTIVE, EXPIRED }

export async function automationsShell(locale: UiLocale | null, node: ReactNode, ent = automationsEnv.hasAccess ? ACTIVE : EXPIRED) {
  const { I18nProvider } = await import('@/lib/i18n/I18nProvider')
  const { EntitlementProvider } = await import('@/lib/entitlement/EntitlementContext')
  const { UserProvider } = await import('@/lib/hooksNEvents')
  const inner = (
    <EntitlementProvider value={ent}>
      <UserProvider user={automationsEnv.user}>{node}</UserProvider>
    </EntitlementProvider>
  )
  // `null`: no provider at all — the Hebrew baseline renders exactly as before i18n.
  return locale ? <I18nProvider locale={locale}>{inner}</I18nProvider> : inner
}

export const AUTOMATION_PAGES = {
  automations: () => import('@/app/(he)/(app)/settings/(admin_settings)/automations/page'),
  templates: () => import('@/app/(he)/(app)/settings/(admin_settings)/automation-templates/page'),
  pilot: () => import('@/app/(he)/(app)/settings/(admin_settings)/automations-pilot/page'),
} as const
export type AutomationPage = keyof typeof AUTOMATION_PAGES

/** The real page inside the real (admin_settings) layout, server parts awaited. */
export async function automationsPage(name: AutomationPage): Promise<ReactNode> {
  const { default: Layout } = (await import('@/app/(he)/(app)/settings/(admin_settings)/layout')) as { default: (p: unknown) => Promise<ReactNode> }
  const { default: Page } = (await AUTOMATION_PAGES[name]()) as { default: (p: unknown) => Promise<ReactNode> }
  return resolveServer(await Layout({ children: await resolveServer(await Page({})) }))
}

/** The website connectors section of Settings → Integrations, for the session user. */
export async function websiteSection(locale: UiLocale = 'he'): Promise<ReactNode> {
  const { default: WebsiteConnection } = (await import('@/components/settings/integrations/WebsiteConnection')) as unknown as {
    default: (p: unknown) => Promise<ReactNode>
  }
  return resolveServer(await WebsiteConnection({ user: automationsEnv.user, locale }))
}

/** Run a page's server reads under `overrides`, then restore the defaults other surfaces expect. */
export async function withAutomationsEnv<T>(overrides: Partial<typeof AUTOMATIONS_DEFAULTS>, build: () => Promise<T>): Promise<T> {
  Object.assign(automationsEnv, structuredClone(AUTOMATIONS_DEFAULTS), overrides, { results: {}, calls: [], active: true })
  try {
    return await build()
  } finally {
    Object.assign(automationsEnv, structuredClone(AUTOMATIONS_DEFAULTS), { results: {}, calls: [], active: false })
  }
}
