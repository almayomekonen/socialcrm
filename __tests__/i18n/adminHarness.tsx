import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import type { UiLocale } from '@/lib/i18n/config'
import { ADMIN_DEFAULTS, adminEnv } from './adminEnv'

/**
 * Renders the admin settings screens (Phase E5) the way the (app) layout does:
 * the interface-language provider, the entitlement state and the session user
 * around the REAL server page, inside the REAL (admin_settings) layout. Async
 * server components are awaited in place. Mocks live in each test file
 * (factories in `adminMocks.ts`). The settings chrome (nav column) is Phase
 * A's and is tested there.
 */

export const ACTIVE = { hasAccess: true, status: 'PAID', expiresAt: null }
export const EXPIRED = { hasAccess: false, status: 'TRIAL_EXPIRED', expiresAt: '2026-10-20T00:00:00.000Z' }
type Ent = typeof ACTIVE

export async function adminShell(locale: UiLocale | null, node: ReactNode, ent: Ent = adminEnv.hasAccess ? ACTIVE : EXPIRED) {
  const { I18nProvider } = await import('@/lib/i18n/I18nProvider')
  const { EntitlementProvider } = await import('@/lib/entitlement/EntitlementContext')
  const { UserProvider } = await import('@/lib/hooksNEvents')
  const inner = (
    <EntitlementProvider value={ent}>
      <UserProvider user={adminEnv.user}>{node}</UserProvider>
    </EntitlementProvider>
  )
  // `null`: no provider at all — the Hebrew baseline renders exactly as before i18n.
  return locale ? <I18nProvider locale={locale}>{inner}</I18nProvider> : inner
}

const isAsync = (type: unknown) => typeof type === 'function' && type.constructor?.name === 'AsyncFunction'

export async function resolveServer(node: ReactNode): Promise<ReactNode> {
  if (Array.isArray(node)) return Promise.all(node.map((n) => resolveServer(n)))
  if (!isValidElement(node)) return node
  const el = node as ReactElement<Record<string, unknown>>
  if (isAsync(el.type)) return resolveServer(await (el.type as (p: unknown) => Promise<ReactNode>)(el.props))
  const next: Record<string, unknown> = {}
  let changed = false
  for (const [key, value] of Object.entries(el.props ?? {})) {
    if (isValidElement(value) || Array.isArray(value)) {
      next[key] = await resolveServer(value as ReactNode)
      changed = true
    }
  }
  return changed ? cloneElement(el, next) : el
}

export const ADMIN_PAGES = {
  editUsers: () => import('@/app/(app)/settings/(admin_settings)/edit_users/page'),
  editTeams: () => import('@/app/(app)/settings/(admin_settings)/edit_teams/page'),
  editPromotions: () => import('@/app/(app)/settings/(admin_settings)/edit_promotions/page'),
  editTmplts: () => import('@/app/(app)/settings/(admin_settings)/edit_tmplts/page'),
  tmpltDetail: () => import('@/app/(app)/settings/(admin_settings)/edit_tmplts/[tmpltTaskId]/page'),
  quoteTemplates: () => import('@/app/(app)/settings/(admin_settings)/quote-templates/page'),
  autoResponse: () => import('@/app/(app)/settings/(admin_settings)/auto-response/page'),
} as const
export type AdminPage = keyof typeof ADMIN_PAGES

/** The real page inside the real (admin_settings) layout, server parts awaited. */
export async function adminPage(name: AdminPage): Promise<ReactNode> {
  const { default: Layout } = (await import('@/app/(app)/settings/(admin_settings)/layout')) as { default: (p: unknown) => Promise<ReactNode> }
  const { default: Page } = (await ADMIN_PAGES[name]()) as { default: (p: unknown) => Promise<ReactNode> }
  const page = await resolveServer(await Page({ params: Promise.resolve({ tmpltTaskId: '4' }) }))
  return resolveServer(await Layout({ children: page }))
}

/** Run a page's server reads under `overrides`, then restore the defaults other surfaces expect. */
export async function withAdminEnv<T>(overrides: Partial<typeof ADMIN_DEFAULTS>, build: () => Promise<T>): Promise<T> {
  Object.assign(adminEnv, structuredClone(ADMIN_DEFAULTS), overrides, { results: {}, calls: [], active: true })
  try {
    return await build()
  } finally {
    Object.assign(adminEnv, structuredClone(ADMIN_DEFAULTS), { results: {}, calls: [], active: false })
  }
}
