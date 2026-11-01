import type { ReactNode } from 'react'
import type { UiLocale } from '@/lib/i18n/config'
import { resolveAsync } from './dashboardHarness'
import { shellEnv } from './mobileShellEnv'

/**
 * Renders the phone shell pieces the way the (app) layout serves them: the
 * interface-language provider around the REAL shell / page. `null` = no
 * provider at all (what a Hebrew user received before i18n). The `vi.mock`
 * factories are in mobileShellMocks.ts and read `shellEnv` (mobileShellEnv.ts).
 */

export async function withLocale(locale: UiLocale | null, node: ReactNode) {
  if (!locale) return <>{node}</>
  const { I18nProvider } = await import('@/lib/i18n/I18nProvider')
  return <I18nProvider locale={locale}>{node}</I18nProvider>
}

/** The shell at `pathname` around `child`, with optional tab badges. */
export async function shellTree(
  locale: UiLocale | null,
  pathname: string,
  child: ReactNode = null,
  counts: { notificationCount?: number; conversationCount?: number } = {},
) {
  shellEnv.pathname = pathname
  const { default: MobileWorkspaceShell } = await import('@/components/mobile/MobileWorkspaceShell')
  return withLocale(locale, <MobileWorkspaceShell {...counts}>{child}</MobileWorkspaceShell>)
}

/** The REAL `/m` server page, resolved, inside the provider. The stored preference follows `locale`. */
export async function moreTree(locale: UiLocale | null) {
  shellEnv.userLocale = locale
  shellEnv.pathname = '/m'
  const { default: Page } = await import('@/app/(he)/(app)/m/page')
  return withLocale(locale, await resolveAsync(await Page()))
}

export async function moreTitle(locale: UiLocale | null) {
  shellEnv.userLocale = locale
  const { generateMetadata } = await import('@/app/(he)/(app)/m/page')
  return (await generateMetadata()).title
}

export async function handoffTree(locale: UiLocale | null, section: Parameters<typeof import('@/components/mobile/MobileDesktopOnly').default>[0]['section']) {
  const { default: MobileDesktopOnly } = await import('@/components/mobile/MobileDesktopOnly')
  return withLocale(locale, <MobileDesktopOnly section={section} />)
}

/** Expected header titles by route (the shell's own rules). */
export const TITLES: Record<'en' | 'ar', Record<string, string>> = {
  en: {
    '/dashboard': 'Today',
    '/leads': 'Leads',
    '/inbox': 'Conversations',
    '/inbox/messenger': 'Conversations',
    '/notifications': 'Notifications',
    '/m': 'More',
    '/clients/5/summary': 'Lead',
    '/agent': 'Your AI agent',
    '/settings/integrations': 'SocialCRM',
    '/tasks': 'SocialCRM',
  },
  ar: {
    '/dashboard': 'اليوم',
    '/leads': 'العملاء المحتملون',
    '/inbox': 'المحادثات',
    '/inbox/messenger': 'المحادثات',
    '/notifications': 'الإشعارات',
    '/m': 'المزيد',
    '/clients/5/summary': 'عميل محتمل',
    '/agent': 'وكيلك الذكي',
    '/settings/integrations': 'SocialCRM',
    '/tasks': 'SocialCRM',
  },
}
