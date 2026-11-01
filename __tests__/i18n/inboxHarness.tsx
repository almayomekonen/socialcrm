import type { ReactNode } from 'react'
import type { UiLocale } from '@/lib/i18n/config'
import { resolveAsync } from './dashboardHarness'
import { ACTIVE, INBOX_DEFAULTS, inboxEnv } from './inboxEnv'

/**
 * Renders the desktop WhatsApp inbox (`/inbox`) the way the (app) layout does:
 * the interface-language provider, the entitlement state and the session user
 * around the REAL server page (async server components resolved in place).
 * The mocks for its I/O live in each test file (factories in inboxMocks.ts).
 */

type Ent = { hasAccess: boolean; status: string; expiresAt: string | null }

export async function inboxShell(locale: UiLocale | null, node: ReactNode, ent: Ent = ACTIVE) {
  const { I18nProvider } = await import('@/lib/i18n/I18nProvider')
  const { EntitlementProvider } = await import('@/lib/entitlement/EntitlementContext')
  const { UserProvider } = await import('@/lib/hooksNEvents')
  const inner = (
    <EntitlementProvider value={ent}>
      <UserProvider user={inboxEnv.user}>{node}</UserProvider>
    </EntitlementProvider>
  )
  // `null`: no provider at all — the Hebrew baseline renders exactly as before i18n.
  return locale ? <I18nProvider locale={locale}>{inner}</I18nProvider> : inner
}

export async function inboxPage(searchParams: Record<string, string> = {}) {
  const { default: Page } = await import('@/app/(he)/(app)/inbox/page')
  const sp = inboxEnv.selected ? { conversation: String(inboxEnv.selected.conversationId), ...searchParams } : searchParams
  return resolveAsync(await Page({ searchParams: Promise.resolve(sp) }))
}

export async function inboxLoading() {
  const { default: Loading } = await import('@/app/(he)/(app)/inbox/loading')
  return <Loading />
}

/** Build under `overrides`, then restore the defaults other renders expect. */
export async function withInboxEnv<T>(overrides: Partial<typeof INBOX_DEFAULTS>, build: () => Promise<T>): Promise<T> {
  Object.assign(inboxEnv, INBOX_DEFAULTS, { active: true }, overrides)
  try {
    return await build()
  } finally {
    Object.assign(inboxEnv, INBOX_DEFAULTS)
  }
}
