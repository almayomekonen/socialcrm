import type { ReactNode } from 'react'
import type { UiLocale } from '@/lib/i18n/config'
import { QUESTIONNAIRE_DEFAULTS, questionnaireEnv } from './questionnaireEnv'
import { ACTIVE, EXPIRED, resolveServer } from './adminHarness'

/**
 * Renders the questionnaire builder (Phase E5c) the way the (app) layout does:
 * the interface-language provider, the entitlement state and the session user
 * around the REAL server page, inside the REAL (admin_settings) layout (async
 * server components awaited in place, see adminHarness). Mocks live in each
 * test file (factories in questionnaireMocks.ts).
 */
export { ACTIVE, EXPIRED }

export async function questionnaireShell(locale: UiLocale | null, node: ReactNode, ent = questionnaireEnv.hasAccess ? ACTIVE : EXPIRED) {
  const { I18nProvider } = await import('@/lib/i18n/I18nProvider')
  const { EntitlementProvider } = await import('@/lib/entitlement/EntitlementContext')
  const { UserProvider } = await import('@/lib/hooksNEvents')
  const inner = (
    <EntitlementProvider value={ent}>
      <UserProvider user={questionnaireEnv.user}>{node}</UserProvider>
    </EntitlementProvider>
  )
  // `null`: no provider at all — the Hebrew baseline renders exactly as before i18n.
  return locale ? <I18nProvider locale={locale}>{inner}</I18nProvider> : inner
}

const PAGE = () => import('@/app/(app)/settings/(admin_settings)/questionnaire/page')

/** The real page inside the real (admin_settings) layout, server parts awaited. A 404 resolves to its message. */
export async function questionnairePage(): Promise<ReactNode> {
  const { default: Layout } = (await import('@/app/(app)/settings/(admin_settings)/layout')) as { default: (p: unknown) => Promise<ReactNode> }
  const { default: Page } = (await PAGE()) as unknown as { default: (p: unknown) => Promise<ReactNode> }
  return resolveServer(await Layout({ children: await resolveServer(await Page({})) }))
}

/** The page's tab title, whether it is declared statically or by `generateMetadata`. */
export async function questionnaireTitle(): Promise<unknown> {
  const mod = (await PAGE()) as { metadata?: { title?: unknown }; generateMetadata?: () => Promise<{ title?: unknown }> }
  return mod.generateMetadata ? (await mod.generateMetadata()).title : mod.metadata?.title
}

/** Run a page's server reads under `overrides`, then restore the defaults other surfaces expect. */
export async function withQuestionnaireEnv<T>(overrides: Partial<typeof QUESTIONNAIRE_DEFAULTS>, build: () => Promise<T>): Promise<T> {
  Object.assign(questionnaireEnv, structuredClone(QUESTIONNAIRE_DEFAULTS), overrides, { results: {}, calls: [], active: true })
  try {
    return await build()
  } finally {
    Object.assign(questionnaireEnv, structuredClone(QUESTIONNAIRE_DEFAULTS), { results: {}, calls: [], active: false })
  }
}
