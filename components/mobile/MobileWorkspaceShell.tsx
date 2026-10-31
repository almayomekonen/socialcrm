'use client'

import { useRef, useState, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import MobileTabBar, { MOBILE_TABS, isTabActive } from './MobileTabBar'
import MobileHeader from './MobileHeader'
import { MobileHeaderActionContext } from './MobileHeaderAction'
import { MobileWorkspaceContext } from './MobileWorkspaceContext'
import { useMobileScrollRestoration } from './useMobileScrollRestoration'
import { useVisibleViewportHeight } from './useVisibleViewportHeight'
import { HEADER_TITLE_KEYS, tabLabel } from './shellCopy'
import { useT } from '@/lib/i18n/I18nProvider'
import { regionAttrs, untranslatedAttrs } from '@/lib/i18n/config'
import type { Translator } from '@/lib/i18n/translate'

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
 * LAYOUT CONTRACT: fill the parent viewport column with `flex-1 min-h-0`, not a
 * second `h-dvh`. The app layout already owns one `h-dvh` column; nesting another
 * 100dvh inside it is taller than iOS Safari's visual viewport, and `body`'s
 * computed `overflow-y: auto` (from `overflow-x: hidden`) then becomes a second
 * scroller. A sticky tab bar stays put while the thread header and composer
 * ride that document scroll — the production iPhone blank-gap.
 *
 * List pages still scroll in `main`. A WhatsApp thread makes `main` a flex
 * column with overflow hidden so the message list is the only scroller.
 * `data-mobile-scroll-owner` is the same opt-in without hiding the header: the
 * page (the /agent workspace) scrolls its own content region and keeps its
 * composer outside it, so nothing it owns scrolls underneath the composer.
 *
 * `main` also drops `overscroll-contain` for the duration of a thread. On a list
 * page `main` IS the scroller, so containing its overscroll is correct. Inside a
 * thread it is instead a zero-slack `overflow: hidden` ancestor sitting between
 * the finger and the real scroller — the same position `html`/`body` held when
 * `overscroll-behavior: none` there was found to swallow touch-scroll on nested
 * overflow regions on iOS (see the rule in main.css). Containing overscroll on
 * an ancestor that cannot scroll buys nothing and risks the same swallow, so the
 * thread list keeps its own `overscroll-contain` and `main` steps out of the way.
 *
 * `MobileWorkspaceContext` tells synchronous `loading.tsx` files which entity
 * is already mounted, so they never await `headers()` (the stuck-skeleton bug).
 *
 * LANGUAGE (i18n Phase F1). The chrome — header title, back label and arrow,
 * tab bar — follows the interface language on every phone route, and the root
 * declares it (`regionAttrs`). `main` re-declares Hebrew (`untranslatedAttrs`)
 * for the phone screens not translated yet, exactly like the desktop `<main>`;
 * translated screens declare their own region inside it. Both spread nothing
 * for Hebrew, so a Hebrew user's DOM is unchanged.
 */

/** Routes with a real mobile presentation. Everything else gets a back arrow. */
const TAB_HREFS = new Set(MOBILE_TABS.map((t) => t.href as string))

function titleFor(pathname: string, t: Translator): { title: string; isTab: boolean } {
  // Lead detail is a stack screen, not a tab. The page itself shows the name;
  // the header only has to say which kind of record this is.
  if (pathname.startsWith('/clients/')) return { title: t(HEADER_TITLE_KEYS.lead), isTab: false }
  // Reached from "עוד", so it is a stack screen and keeps its back arrow.
  if (pathname.startsWith('/agent')) return { title: t(HEADER_TITLE_KEYS.agent), isTab: false }
  const tab = MOBILE_TABS.find((candidate) => isTabActive(pathname, candidate.href))
  if (tab && TAB_HREFS.has(tab.href as string)) {
    // A tab screen is a destination, not a stack — no back arrow.
    return { title: tabLabel(tab, t), isTab: isTabActive(pathname, tab.href) && pathname.split('/').length <= 2 }
  }
  return { title: tab ? tabLabel(tab, t) : 'SocialCRM', isTab: false }
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
  const t = useT()
  const { title, isTab } = titleFor(pathname, t)
  const [headerAction, setHeaderAction] = useState<ReactNode>(null)

  /**
   * The scroll region below is the app's scroller, not the document's, so
   * history scroll restoration does not reach it — see the hook for the full
   * argument. Restoration is therefore explicit, and scoped to this shell.
   */
  const scrollerRef = useRef<HTMLElement | null>(null)
  useMobileScrollRestoration(scrollerRef)

  /**
   * Pins the workspace column to the viewport the user can actually see, so the
   * software keyboard cannot throw the thread header off the top. Publishes two
   * CSS properties and nothing else; the geometry is `mobile-viewport-column`
   * on the column in `app/(app)/layout.tsx`.
   */
  useVisibleViewportHeight()

  return (
    <MobileWorkspaceContext.Provider value={true}>
      <MobileHeaderActionContext.Provider value={setHeaderAction}>
        {/* `data-mobile-workspace` is the scoping hook for the `full-bleed`
           neutralisation in main.css — see the rule there for why it is needed. */}
        <div
          data-mobile-workspace
          {...regionAttrs(t.locale)}
          className='flex min-h-0 flex-1 flex-col overflow-hidden bg-bg has-[[data-wa-thread-chrome]]:[&_[data-mobile-header]]:hidden has-[[data-wa-thread-chrome]]:[&_#main-content]:overflow-hidden has-[[data-wa-thread-chrome]]:[&_#main-content]:overscroll-auto has-[[data-mobile-scroll-owner]]:[&_#main-content]:overflow-hidden has-[[data-mobile-scroll-owner]]:[&_#main-content]:overscroll-auto'
        >
          <MobileHeader title={title} onBack={isTab ? undefined : true} action={headerAction} />

          {/* Flex column so the thread can be `flex-1 min-h-0` instead of
              `h-full`. Percentage height against a block-level flex item is
              what iOS Safari fails to resolve against the visual viewport. */}
          <main
            id='main-content'
            ref={scrollerRef}
            tabIndex={-1}
            className='flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain focus:outline-none'
            {...untranslatedAttrs(t.locale)}
          >
            {children}
          </main>

          <MobileTabBar notificationCount={notificationCount} conversationCount={conversationCount} />
        </div>
      </MobileHeaderActionContext.Provider>
    </MobileWorkspaceContext.Provider>
  )
}
