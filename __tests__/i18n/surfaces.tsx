import type { ReactElement } from 'react'
import type { UiLocale } from '@/lib/i18n/config'
import type { Allowance } from './leakScan'
import { DASHBOARD_CUSTOMER_DATA, STATS, dashboardEnv } from './dashboardFixtures'
import { resolveAsync } from './dashboardHarness'

/**
 * COMPLETED screens. A screen is listed here only when every piece of
 * system-generated text in it is translated; from then on leakGate.test.tsx
 * fails if Hebrew reappears in its en/ar render outside `allowed`.
 *
 * Adding a screen (Phase B onwards): render it with realistic fixture data,
 * list only the data values it shows verbatim, and give each a reason.
 * Unused allowances fail the gate, so this list cannot drift into a blanket
 * suppression.
 *
 * Rendering relies on the mocks declared in leakGate.test.tsx (navigation,
 * session, locale read). `locale` is applied both to the client provider and
 * to the mocked stored preference, so server-rendered parts translate too.
 */

export const FIXTURE_USER = { id: 7, name: 'דנה כהן', role: 'ADMIN', agencyId: 103 }

export type Surface = {
  name: string
  route: string
  render: (locale: UiLocale) => Promise<ReactElement>
  allowed: Allowance[]
}

export const SURFACES: Surface[] = [
  {
    name: 'app shell (topbar + side nav)',
    route: '(all workspace routes)',
    render: async (locale) => {
      const { I18nProvider } = await import('@/lib/i18n/I18nProvider')
      const { default: Topbar } = await import('@/lib/navs/Topbar')
      const { default: Nav } = await import('@/lib/navs/Nav')
      return (
        <I18nProvider locale={locale}>
          <Topbar user={FIXTURE_USER} trialDaysRemaining={3} />
          <Nav user={FIXTURE_USER} inboxUnread={4} />
        </I18nProvider>
      )
    },
    allowed: [
      { text: 'דנה כהן', reason: 'customer-data' },
      { text: 'ד', reason: 'customer-data' },
    ],
  },
  {
    name: 'settings navigation',
    route: '/settings/*',
    render: async (locale) => {
      const { I18nProvider } = await import('@/lib/i18n/I18nProvider')
      const { default: SettingLayout } = await import('@/app/(app)/settings/layout')
      return <I18nProvider locale={locale}>{await SettingLayout({ children: null })}</I18nProvider>
    },
    allowed: [],
  },
  {
    name: 'language settings',
    route: '/settings/language',
    render: async (locale) => {
      const { I18nProvider } = await import('@/lib/i18n/I18nProvider')
      const { default: LanguageSettings } = await import('@/components/settings/language/LanguageSettings')
      return (
        <I18nProvider locale={locale}>
          <LanguageSettings locale={locale} source='user' userLocale={locale} agencyLocale={null} canManageAgency />
        </I18nProvider>
      )
    },
    allowed: [{ text: 'עברית', reason: 'endonym' }],
  },
  ...(
    [
      ['desktop, Today brief v2 + analytics', { mobile: false, v2: true, stats: STATS }, ['דנה כהן', 'דנה', 'יוסי לוי', 'רונית', 'שיחת היכרות', 'יל', 'ר']],
      ['desktop, analytics unavailable', { mobile: false, v2: true, stats: null }, ['דנה כהן', 'דנה', 'יוסי לוי', 'רונית', 'שיחת היכרות', 'יל', 'ר']],
      ['desktop, legacy worklist', { mobile: false, v2: false, stats: STATS }, ['דנה כהן']],
      ['mobile, Today brief v2', { mobile: true, v2: true, stats: STATS }, ['דנה כהן', 'יוסי לוי', 'רונית']],
      ['mobile, legacy worklist', { mobile: true, v2: false, stats: STATS }, ['דנה כהן']],
    ] as const
  ).map(
    ([variant, env, data]): Surface => ({
      name: `dashboard — ${variant}`,
      route: '/dashboard',
      render: async (locale) => {
        Object.assign(dashboardEnv, env)
        const { I18nProvider } = await import('@/lib/i18n/I18nProvider')
        const { default: DashboardPage } = await import('@/components/home/DashboardPage')
        const page = await resolveAsync(await DashboardPage({ searchParams: Promise.resolve({}) }))
        // The (app) layout provides the client-side translator for the same locale.
        return <I18nProvider locale={locale}>{page}</I18nProvider>
      },
      allowed: data.map((text) => {
        if (!DASHBOARD_CUSTOMER_DATA.includes(text)) throw new Error(`not declared as customer data: ${text}`)
        return { text, reason: 'customer-data' as const }
      }),
    }),
  ),
]
