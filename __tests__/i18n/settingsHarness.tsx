import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import type { UiLocale } from '@/lib/i18n/config'
import { SET_DEFAULTS, setEnv } from './settingsEnv'

/**
 * Renders the user settings screens (Phase E4) the way the (app) layout does:
 * the interface-language provider, the entitlement state and the session user
 * around the REAL server page. Async server components are awaited in place;
 * `TemplatesSection` is a SYNC server component that holds one (the template
 * list), so it is expanded too. Mocks live in each test file (factories in
 * `settingsMocks.ts`). The settings chrome (nav column) is Phase A's and is
 * tested there; pages are rendered on their own.
 */

export const ACTIVE = { hasAccess: true, status: 'PAID', expiresAt: null }
export const EXPIRED = { hasAccess: false, status: 'TRIAL_EXPIRED', expiresAt: '2026-10-20T00:00:00.000Z' }
type Ent = typeof ACTIVE

export async function setShell(locale: UiLocale | null, node: ReactNode, ent: Ent = setEnv.hasAccess ? ACTIVE : EXPIRED) {
  const { I18nProvider } = await import('@/lib/i18n/I18nProvider')
  const { EntitlementProvider } = await import('@/lib/entitlement/EntitlementContext')
  const { UserProvider } = await import('@/lib/hooksNEvents')
  const inner = (
    <EntitlementProvider value={ent}>
      <UserProvider user={setEnv.user}>{node}</UserProvider>
    </EntitlementProvider>
  )
  // `null`: no provider at all — the Hebrew baseline renders exactly as before i18n.
  return locale ? <I18nProvider locale={locale}>{inner}</I18nProvider> : inner
}

const isAsync = (type: unknown) => typeof type === 'function' && type.constructor?.name === 'AsyncFunction'

async function resolveServer(node: ReactNode, expand: ReadonlySet<unknown>): Promise<ReactNode> {
  if (Array.isArray(node)) return Promise.all(node.map((n) => resolveServer(n, expand)))
  if (!isValidElement(node)) return node
  const el = node as ReactElement<Record<string, unknown>>
  if (isAsync(el.type)) return resolveServer(await (el.type as (p: unknown) => Promise<ReactNode>)(el.props), expand)
  if (expand.has(el.type)) return resolveServer((el.type as (p: unknown) => ReactNode)(el.props), expand)
  const next: Record<string, unknown> = {}
  let changed = false
  for (const [key, value] of Object.entries(el.props ?? {})) {
    if (isValidElement(value) || Array.isArray(value)) {
      next[key] = await resolveServer(value as ReactNode, expand)
      changed = true
    }
  }
  return changed ? cloneElement(el, next) : el
}

async function serverTypes() {
  const { default: TemplatesSection } = await import('@/components/settings/templates/TemplatesSection')
  return new Set<unknown>([TemplatesSection])
}

const sp = () => Promise.resolve({ ...setEnv.searchParams })

export const SETTINGS_PAGES = {
  selfEdit: () => import('@/app/(he)/(app)/settings/(user_settings)/self_edit/page'),
  userDetails: () => import('@/app/(he)/(app)/settings/(user_settings)/update_user_details/page'),
  security: () => import('@/app/(he)/(app)/settings/(user_settings)/update_security/page'),
  system: () => import('@/app/(he)/(app)/settings/(user_settings)/update_default/page'),
  reminders: () => import('@/app/(he)/(app)/settings/(user_settings)/whatsapp_reminders/page'),
  agency: () => import('@/app/(he)/(app)/settings/(user_settings)/update_agency/page'),
  payment: () => import('@/app/(he)/(app)/settings/(user_settings)/update_payment/page'),
  integrations: () => import('@/app/(he)/(app)/settings/(user_settings)/integrations/page'),
} as const
export type SettingsPage = keyof typeof SETTINGS_PAGES

/** The real page, server parts awaited. */
export async function settingsPage(name: SettingsPage): Promise<ReactNode> {
  const { default: Page } = (await SETTINGS_PAGES[name]()) as { default: (p: unknown) => Promise<ReactNode> }
  return resolveServer(await Page({ searchParams: sp() }), await serverTypes())
}

/**
 * Run a page's server reads under `overrides`, then restore the defaults other
 * surfaces expect. `searchParams` survive (client parts read the URL when they
 * render); `resetSetEnv` clears them.
 */
export async function withSetEnv<T>(overrides: Partial<typeof SET_DEFAULTS> & { searchParams?: Record<string, string> }, build: () => Promise<T>): Promise<T> {
  Object.assign(setEnv, structuredClone(SET_DEFAULTS), { searchParams: {} }, overrides, { results: {}, calls: [], active: true })
  try {
    return await build()
  } finally {
    Object.assign(setEnv, structuredClone(SET_DEFAULTS), { results: {}, calls: [], active: false })
  }
}
