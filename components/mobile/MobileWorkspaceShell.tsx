'use client'

import { useRef, useState, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import MobileTabBar, { MOBILE_TABS, isTabActive } from './MobileTabBar'
import MobileHeader from './MobileHeader'
import { MobileHeaderActionContext } from './MobileHeaderAction'
import { MobileWorkspaceContext } from './MobileWorkspaceContext'
import { useMobileScrollRestoration } from './useMobileScrollRestoration'

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
 *
 * `MobileWorkspaceContext` tells synchronous `loading.tsx` files which entity
 * is already mounted, so they never await `headers()` (the stuck-skeleton bug).
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
  conversationCount = 0,
}: {
  children: ReactNode
  /** Unread NOTIFICATION rows → the התראות tab. */
  notificationCount?: number
  /** Unread WhatsApp CONVERSATIONS → the שיחות tab. */
  conversationCount?: number
}) {
  const pathname = usePathname()
  const { title, isTab } = titleFor(pathname)
  const [headerAction, setHeaderAction] = useState<ReactNode>(null)

  /**
   * The scroll region below is the app's scroller, not the document's, so
   * history scroll restoration does not reach it — see the hook for the full
   * argument. Restoration is therefore explicit, and scoped to this shell.
   */
  const scrollerRef = useRef<HTMLElement | null>(null)
  useMobileScrollRestoration(scrollerRef)

  return (
    <MobileWorkspaceContext.Provider value={true}>
      <MobileHeaderActionContext.Provider value={setHeaderAction}>
        {/* `data-mobile-workspace` is the scoping hook for the `full-bleed`
           neutralisation in main.css — see the rule there for why it is needed. */}
        <div
          data-mobile-workspace
          className='flex h-dvh flex-col bg-bg has-[[data-wa-thread-chrome]]:[&_[data-mobile-header]]:hidden has-[[data-wa-thread-chrome]]:[&_#main-content]:overflow-hidden'
        >
          <MobileHeader title={title} onBack={isTab ? undefined : true} action={headerAction} />

          {/* List pages scroll here. A WhatsApp thread must NOT: it is `h-full`
              of this region, so scrolling `main` reveals empty space below the
              thread. `min-h-0` keeps the tab bar on-screen. */}
          <main
            id='main-content'
            ref={scrollerRef}
            tabIndex={-1}
            className='min-h-0 flex-1 overflow-y-auto focus:outline-none'
          >
            {children}
          </main>

          <MobileTabBar notificationCount={notificationCount} conversationCount={conversationCount} />
        </div>
      </MobileHeaderActionContext.Provider>
    </MobileWorkspaceContext.Provider>
  )
}
