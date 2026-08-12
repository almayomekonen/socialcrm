'use client'

import type { ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import MobileTabBar, { MOBILE_TABS, isTabActive } from './MobileTabBar'
import MobileHeader from './MobileHeader'

/**
 * The mobile workspace chrome: header on top, page in the middle, tab bar below.
 *
 * Rendered INSTEAD of the desktop `WorkspaceGrid` (Topbar + Nav + Copilot), never
 * alongside it. The choice is made once, on the server, in `app/(app)/layout.tsx`
 * — desktop requests never receive this component and mobile requests never
 * receive the desktop shell (architecture-rules.md §9: gate by absence, never
 * CSS-hide). Nothing here is viewport-conditional.
 *
 * Client Component only because the header title and the active tab both derive
 * from `usePathname()`. It holds no data and fetches nothing; `children` is the
 * server-rendered page.
 *
 * LAYOUT CONTRACT: `h-dvh` + a single `overflow-y-auto` middle region. The header
 * and tab bar are siblings of the scroll region, not `position: fixed` overlays,
 * so no page has to reserve padding for them and no page can be clipped behind
 * them. `dvh` (not `vh`) so mobile browser chrome collapsing does not leave the
 * tab bar floating above the fold.
 */

/** Routes with a real mobile presentation. Everything else gets a back arrow. */
const TAB_HREFS = new Set(MOBILE_TABS.map((t) => t.href as string))

function titleFor(pathname: string): { title: string; isTab: boolean } {
  // Lead detail is a stack screen, not a tab. The page itself shows the name;
  // the header only has to say which kind of record this is.
  if (pathname.startsWith('/clients/')) return { title: 'ליד', isTab: false }
  const tab = MOBILE_TABS.find((t) => isTabActive(pathname, t.href))
  if (tab && TAB_HREFS.has(tab.href as string)) {
    // A tab screen is a destination, not a stack — no back arrow.
    return { title: tab.title, isTab: isTabActive(pathname, tab.href) && pathname.split('/').length <= 2 }
  }
  return { title: tab?.title ?? 'SocialCRM', isTab: false }
}

export default function MobileWorkspaceShell({
  children,
  notificationCount = 0,
}: {
  children: ReactNode
  notificationCount?: number
}) {
  const pathname = usePathname()
  const { title, isTab } = titleFor(pathname)

  return (
    /* `data-mobile-workspace` is the scoping hook for the `full-bleed`
       neutralisation in main.css — see the rule there for why it is needed. */
    <div data-mobile-workspace className='flex h-dvh flex-col bg-bg'>
      <MobileHeader title={title} onBack={isTab ? undefined : true} />

      {/* The ONLY scroll container. `min-h-0` is load-bearing in a flex column:
          without it the region refuses to shrink and the tab bar is pushed off
          the bottom of the viewport. */}
      <main id='main-content' tabIndex={-1} className='min-h-0 flex-1 overflow-y-auto focus:outline-none'>
        {children}
      </main>

      <MobileTabBar notificationCount={notificationCount} />
    </div>
  )
}
