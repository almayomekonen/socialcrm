'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { Route } from 'next'
import Icon, { type IconNames } from '@/lib/Icon'
import NavBadge from '@/lib/navs/NavBadge'
import { useAwarenessCount } from '@/modules/inbox/awareness/AwarenessContext'
import { useNotificationUnreadCount, useNotifications } from '@/modules/notifications/NotificationContext'

/**
 * The mobile bottom navigation — היום · לידים · שיחות · התראות · עוד.
 *
 * FIVE SLOTS. The desktop sidebar carries ten destinations; a phone gets the
 * five that serve the mobile job (Desktop = MANAGE, Mobile = ACT). שיחות earned
 * a slot rather than a place inside "עוד": replying is daily work, and a tab bar
 * that hides the most frequent action is a menu with extra steps.
 *
 * Five is the ceiling. At 360px each slot is 72px, which fits a 20px icon and a
 * short Hebrew label — a sixth would start truncating labels, and an icon-only
 * tab fails both the ambiguous-icon rule and the accessible-name rule.
 *
 * היום is slot 1 and the mobile landing screen: `/dashboard` already answers
 * "what should I do next", which is the question a rep opens their phone to ask.
 *
 * Rendered only for requests the SERVER has already classified as mobile
 * (`architecture-rules.md` §9 — gate by absence, never CSS-hide), so this
 * component contains no viewport check of its own.
 */

export type MobileTab = {
  icon: IconNames
  href: Route
  title: string
  /** Unread count. Rendered as a badge and folded into the accessible name. */
  badge?: number
}

export const MOBILE_TABS: MobileTab[] = [
  { icon: 'house', href: '/dashboard' as Route, title: 'היום' },
  { icon: 'image-polaroid-user', href: '/leads' as Route, title: 'לידים' },
  // שיחות is a first-class destination, never folded into "עוד": replying is
  // daily work, and burying it one level down would cost a tap on the action
  // reps perform most.
  { icon: 'comments', href: '/inbox' as Route, title: 'שיחות' },
  { icon: 'bell', href: '/notifications' as Route, title: 'התראות' },
  { icon: 'ellipsis', href: '/m' as Route, title: 'עוד' },
]

/**
 * Active-tab matching on the first path segment, mirroring the desktop `Nav`
 * exactly. Sharing the rule matters: if the two disagree, a user who switches
 * devices sees a different tab highlighted for the same URL.
 */
export function isTabActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/'
  return pathname.startsWith('/' + href.split('/')[1])
}

export default function MobileTabBar({
  notificationCount = 0,
  conversationCount = 0,
}: {
  /** Unread NOTIFICATION rows. Never the conversation count. */
  notificationCount?: number
  /** Unread WhatsApp CONVERSATIONS. Never the notification count. */
  conversationCount?: number
}) {
  const pathname = usePathname()
  const { enabled: notificationsEnabled } = useNotifications()
  const liveNotifications = useNotificationUnreadCount()
  const liveConversations = useAwarenessCount()
  // Notifications: same live owner as the desktop bell (NotificationContext).
  // Conversations: same live owner as the desktop Nav (AwarenessContext).
  // The layout props are the first-paint seed / fallback — never mixed.
  const notifications = notificationsEnabled ? liveNotifications : notificationCount
  const conversations = liveConversations ?? conversationCount
  const tabs = mobileTabsWithBadges({ notifications, conversations })

  return (
    <nav
      aria-label='ניווט ראשי'
      /* Safe-area padding, not margin: the bar's background must extend UNDER the
         home indicator, while its touch targets stay above it. */
      className='sticky bottom-0 z-50 shrink-0 border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom,0px)]'
    >
      <ul className='flex items-stretch justify-around'>
        {tabs.map((tab) => {
          const active = isTabActive(pathname, tab.href)
          const hasBadge = tab.badge != null && tab.badge > 0
          return (
            <li key={tab.href} className='flex-1'>
              <Link
                href={tab.href}
                /* Default prefetch also fires a Flight request for every visible
                   lead-detail Link. Safari allows few connections per host, so
                   those prefetches can abort or delay the tap's own RSC. Five
                   tab destinations are fetched on tap instead. */
                prefetch={false}
                aria-current={active ? 'page' : undefined}
                /* The badge is aria-hidden (it is a visual echo), so the count
                   has to reach assistive tech through the link's name instead. */
                aria-label={hasBadge ? `${tab.title}, ${tab.badge} חדשות` : undefined}
                /* min-h-14 = 56px, comfortably past the 44px minimum even before
                   the label wraps. */
                className={`flex min-h-14 flex-col items-center justify-center gap-1 px-0.5 py-2 transition-colors active:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ${
                  active ? 'text-primary-text' : 'text-gray-500'
                }`}
              >
                <span className='relative'>
                  <Icon
                    name={tab.icon}
                    type='sol'
                    className={`size-5 ${active ? 'bg-primary' : 'bg-gray-500'}`}
                  />
                  {hasBadge ? <NavBadge count={tab.badge!} /> : null}
                </span>
                {/* Text label always present — icon-only tabs fail both the
                    "no ambiguous icons" rule and the accessible-name rule. */}
                <span className={`max-w-full truncate text-[10.5px] leading-none ${active ? 'font-semibold' : 'font-medium'}`}>
                  {tab.title}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

/**
 * Fold the live unread counts into the tab set. Exported so the shell and the
 * a11y suite exercise the same badge rule the bar itself uses.
 *
 * TWO COUNTS, TWO TABS, NAMED — NOT POSITIONAL.
 *
 * These are different questions about different tables, and they clear through
 * different user actions:
 *
 *   התראות ← `countUnreadNotifications`          (notifications.readAt)
 *   שיחות  ← `countUnreadConversationsForUser`   (inbox_conversation_reads.lastReadAt)
 *
 * This function previously took ONE positional number and put it on the
 * notifications tab — while the only caller passed it `inboxUnread`. The bar
 * therefore showed unread CONVERSATIONS on the התראות tab, so reading every
 * notification could never clear it (only replying to WhatsApp could). Desktop
 * never had the bug: `Nav` puts `inboxUnread` on `/inbox`, and the bell reads
 * the notification count from `NotificationContext` — `NotificationBell` even
 * carries the comment "THE BADGE IS NOTIFICATIONS, NOT CONVERSATIONS".
 *
 * The argument is an OBJECT so the fix cannot silently regress: the two numbers
 * are indistinguishable to the type system as positional parameters, and the
 * original defect was passing a correct value into the wrong slot. Named keys
 * make that mistake unrepresentable rather than merely currently-correct.
 */
export function mobileTabsWithBadges(counts: { notifications: number; conversations: number }): MobileTab[] {
  return MOBILE_TABS.map((t) => {
    if (t.href === '/notifications') return { ...t, badge: counts.notifications }
    if (t.href === '/inbox') return { ...t, badge: counts.conversations }
    return t
  })
}
