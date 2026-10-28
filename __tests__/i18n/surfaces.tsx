import type { ReactElement } from 'react'
import type { UiLocale } from '@/lib/i18n/config'
import type { Allowance } from './leakScan'

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
]
