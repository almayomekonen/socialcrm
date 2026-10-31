import type { ReactNode } from 'react'
import type { UiLocale } from '@/lib/i18n/config'
import type { NotificationFeedItem, WhileYouWereAway } from '@/modules/notifications/types'
import { resolveAsync } from './dashboardHarness'
import { notifEnv } from './notificationsState'

/**
 * Renders the notification surfaces the way the (app) layout serves them: the
 * interface-language provider around the notification state owner around the
 * REAL page / panel. `null` = no language provider at all (what a Hebrew user
 * received before i18n). The `vi.mock` factories are in notificationsMocks.ts.
 */

export async function withLocale(locale: UiLocale | null, node: ReactNode) {
  if (!locale) return <>{node}</>
  const { I18nProvider } = await import('@/lib/i18n/I18nProvider')
  return <I18nProvider locale={locale}>{node}</I18nProvider>
}

/** The notification state owner, enabled, with the badge's server count. */
export async function withNotifications(node: ReactNode, initialUnread = 3) {
  const { NotificationProvider } = await import('@/modules/notifications/NotificationContext')
  return (
    <NotificationProvider enabled initialUnread={initialUnread}>
      {node}
    </NotificationProvider>
  )
}

/** The REAL `/notifications` server page for `search`, resolved. The stored preference follows `locale`. */
export async function pageTree(
  locale: UiLocale | null,
  search: Record<string, string> = {},
  opts: { rows?: NotificationFeedItem[]; mobile?: boolean; unread?: number } = {},
) {
  notifEnv.userLocale = locale
  if (opts.rows) notifEnv.rows = opts.rows
  if (opts.mobile !== undefined) notifEnv.mobile = opts.mobile
  const { default: Page } = await import('@/app/(app)/notifications/page')
  const page = await resolveAsync(await Page({ searchParams: Promise.resolve(search) }))
  return withLocale(locale, await withNotifications(page, opts.unread ?? 3))
}

export async function pageTitle(locale: UiLocale | null) {
  notifEnv.userLocale = locale
  const mod = (await import('@/app/(app)/notifications/page')) as {
    metadata?: { title?: unknown }
    generateMetadata?: () => Promise<{ title?: unknown }>
  }
  if (mod.generateMetadata) return (await mod.generateMetadata()).title
  return mod.metadata?.title
}

export const AWAY: WhileYouWereAway = {
  since: new Date(Date.parse('2026-10-30T09:00:00Z') - 3 * 3600_000).toISOString(),
  total: 4,
  categories: [
    { category: 'leads', count: 3 },
    { category: 'followups', count: 1 },
  ],
}

/** The bell's panel, presentation only (the bell itself is exercised in the interaction tests). */
export async function panelTree(
  locale: UiLocale | null,
  props: { items: NotificationFeedItem[]; whileYouWereAway?: WhileYouWereAway | null; unreadCount?: number },
) {
  const { default: NotificationPanel } = await import('@/components/notifications/NotificationPanel')
  return withLocale(
    locale,
    <NotificationPanel
      containerRef={{ current: null }}
      pos={{ top: 40, left: 10, width: 340 }}
      items={props.items}
      whileYouWereAway={props.whileYouWereAway ?? null}
      unreadCount={props.unreadCount ?? 0}
      onSelect={() => {}}
      onMarkAllRead={() => {}}
      onClose={() => {}}
    />,
  )
}
