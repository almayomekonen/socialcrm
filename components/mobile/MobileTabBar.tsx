'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { Route } from 'next'
import Icon, { type IconNames } from '@/lib/Icon'
import NavBadge from '@/lib/navs/NavBadge'

/**
 * The mobile bottom navigation — Today · Leads · Notifications · More.
 *
 * FOUR SLOTS, FIXED. The desktop sidebar carries ten destinations; a phone gets
 * the four that serve the mobile job (Desktop = MANAGE, Mobile = ACT). Everything
 * else lives behind "More" rather than being squeezed in — five-plus tabs is how
 * a tab bar becomes a menu with extra steps.
 *
 * Today is slot 1 and the mobile landing screen: `/dashboard` already answers
 * "what should I do next" (RecommendedLeads + LeadQuickActions + follow-ups),
 * which is exactly the question a rep opens their phone to ask.
 *
 * NOT MOUNTED YET. Phase 1 builds the primitive; the shell mounts it in Phase 2
 * once Today has a mobile presentation to land on. It is rendered only for
 * requests the SERVER has already classified as mobile
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

export default function MobileTabBar({ notificationCount = 0 }: { notificationCount?: number }) {
  const pathname = usePathname()
  const tabs = mobileTabsWithBadges(notificationCount)

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
                aria-current={active ? 'page' : undefined}
                /* The badge is aria-hidden (it is a visual echo), so the count
                   has to reach assistive tech through the link's name instead. */
                aria-label={hasBadge ? `${tab.title}, ${tab.badge} חדשות` : undefined}
                /* min-h-14 = 56px, comfortably past the 44px minimum even before
                   the label wraps. */
                className={`flex min-h-14 flex-col items-center justify-center gap-1 px-1 py-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ${
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
                <span className={`text-[11px] leading-none ${active ? 'font-semibold' : 'font-medium'}`}>
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
 * Fold the live unread count into the tab set. Exported so the Phase 2 shell and
 * the a11y suite exercise the same badge rule the bar itself uses.
 */
export function mobileTabsWithBadges(notificationCount: number): MobileTab[] {
  return MOBILE_TABS.map((t) => (t.href === '/notifications' ? { ...t, badge: notificationCount } : t))
}
