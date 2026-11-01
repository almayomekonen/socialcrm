import type { ReactNode } from 'react'
import type { UiLocale } from '@/lib/i18n/config'
import { CLIENT_LISTS, ROWS, USERS } from './leadsFixtures'

/**
 * Renders /leads and /clients the way the (app) layout does: the interface
 * language provider, the session user, the table scroll-position store and
 * the sync-health store around the page. Mocks for the page's reads live in
 * the test file (leakGate.test.tsx, leadsLocales.test.tsx).
 */

export const LEADS_USER = { id: 7, name: 'דנה כהן', role: 'ADMIN', agencyId: 103 }

export async function LeadsShell({ locale, user = LEADS_USER, children }: { locale: UiLocale; user?: unknown; children: ReactNode }) {
  const { I18nProvider } = await import('@/lib/i18n/I18nProvider')
  const { UserProvider, PosProvider } = await import('@/lib/hooksNEvents')
  const { CrmSyncHealthProvider } = await import('@/lib/polling/CrmSyncHealthContext')
  return (
    <I18nProvider locale={locale}>
      <CrmSyncHealthProvider>
        <UserProvider user={user}>
          <PosProvider>{children}</PosProvider>
        </UserProvider>
      </CrmSyncHealthProvider>
    </I18nProvider>
  )
}

/** The page context (`useProps`) a list page provides, for components rendered on their own. */
export async function PageProps({ children, search = '' }: { children: ReactNode; search?: string }) {
  const { Provider } = await import('@/lib/hooksNEvents')
  return (
    <Provider
      props={{
        tableLength: ROWS.length,
        params: Object.fromEntries(new URLSearchParams(search)),
        clientLists: CLIENT_LISTS,
        clients: ROWS,
        handlers: USERS,
        users: USERS,
      }}
    >
      {children}
    </Provider>
  )
}

export async function leadsPage(params: Record<string, string> = {}) {
  const { default: LeadsPage } = await import('@/app/(he)/(app)/leads/page')
  return LeadsPage({ searchParams: Promise.resolve(params) })
}

export async function clientsPage(params: Record<string, string> = {}) {
  const { default: ClientsPage } = await import('@/app/(he)/(app)/clients/page')
  return ClientsPage({ searchParams: Promise.resolve(params) })
}

/** Resolve the async server wrappers above into a plain element tree for `render`. */
export async function shell(locale: UiLocale, children: ReactNode, opts: { search?: string; user?: unknown } = {}) {
  const inner = await PageProps({ children, search: opts.search })
  return LeadsShell({ locale, user: opts.user, children: inner })
}
