import type { ReactNode } from 'react'
import type { UiLocale } from '@/lib/i18n/config'
import type { Surface } from './surfaces'
import { resolveAsync } from './dashboardHarness'

/**
 * Leak-gate registrations for the phone shell (i18n Phase F1). Spread into
 * SURFACES (surfaces.tsx). The gate's `usePathname` is `/leads`, so the shell
 * is scanned on a tab screen; every route's header title is asserted in
 * mobileShellLocales.test.tsx. The child inside `<main>` is translated content
 * (a handoff), because `<main>` itself declares Hebrew for the rest.
 */

async function provider(locale: UiLocale, node: ReactNode) {
  const { I18nProvider } = await import('@/lib/i18n/I18nProvider')
  return <I18nProvider locale={locale}>{node}</I18nProvider>
}

const SECTIONS = [
  'tasks',
  'calendar',
  'deals',
  'clients',
  'sum_sales',
  'files',
  'promotion',
  'lead_tasks',
  'lead_files',
  'lead_billing',
  'ai_inspector',
] as const

export const MOBILE_SHELL_SURFACES: Surface[] = [
  {
    name: 'phone shell — header, tab bar with both badges, a handoff inside',
    route: '/leads (phone)',
    render: async (locale) => {
      const { default: MobileWorkspaceShell } = await import('@/components/mobile/MobileWorkspaceShell')
      const { default: MobileDesktopOnly } = await import('@/components/mobile/MobileDesktopOnly')
      return provider(
        locale,
        <MobileWorkspaceShell notificationCount={3} conversationCount={12}>
          <MobileDesktopOnly section='deals' />
        </MobileWorkspaceShell>,
      )
    },
    allowed: [],
  },
  {
    name: 'phone "More" page (/m) — every section, the desktop note, the session rows',
    route: '/m (phone)',
    render: async (locale) => {
      const { dashboardEnv } = await import('./dashboardFixtures')
      dashboardEnv.mobile = true // the page redirects a desktop request away
      const { default: Page } = await import('@/app/(he)/(app)/m/page')
      return provider(locale, await resolveAsync(await Page()))
    },
    // The signed-in rep's own name, shown as their identity row.
    allowed: [{ text: 'דנה כהן', reason: 'customer-data' }],
  },
  {
    name: 'phone desktop-only handoffs — every section',
    route: '/tasks, /calendar, /deals, /clients, /sum_sales, /files, /promotion, lead tabs, ai-inspector (phone)',
    render: async (locale) => {
      const { default: MobileDesktopOnly } = await import('@/components/mobile/MobileDesktopOnly')
      return provider(
        locale,
        <>
          {SECTIONS.map((section) => (
            <MobileDesktopOnly key={section} section={section} />
          ))}
        </>,
      )
    },
    allowed: [],
  },
  {
    name: 'phone shell-level skeletons — every destination shape',
    route: '(tab navigation inside the phone shell)',
    render: async (locale) => {
      const { default: MobileInnerSkeleton } = await import('@/components/mobile/skeletons/MobileInnerSkeleton')
      const paths = ['/clients/5', '/leads', '/inbox?conversation=5', '/inbox', '/notifications', '/m', '/settings/integrations?section=templates', '/settings/integrations', '/dashboard']
      return provider(
        locale,
        <>
          {paths.map((path) => (
            <MobileInnerSkeleton key={path} path={path} />
          ))}
        </>,
      )
    },
    allowed: [],
  },
]
