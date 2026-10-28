'use client'

import type { ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { useT } from '@/lib/i18n/I18nProvider'
import { regionAttrs, untranslatedAttrs } from '@/lib/i18n/config'

/**
 * The settings chrome: the nav column and the content cell.
 *
 * EVERY route keeps the nav, אוטומציות included. Someone inside Settings should
 * never lose the column that tells them where they are — a screen that swaps the
 * whole shell reads as a different place, not a different page.
 *
 * What אוטומציות gets instead is a tighter chrome, because it is the one route
 * whose content is itself two columns. Halving the gutter and dropping the
 * padding on the content side returns ~56px to the workspace and lets the
 * control centre's hairline reach the window the way it was drawn.
 *
 * THE NAV ITSELF IS NOT NARROWED. `max-w-52` is a cap, not a width — the column
 * is `auto`, so it already sits at whatever its widest label needs (תבניות
 * אוטומציה, around 174px). Lowering the cap would not reclaim space, it would
 * only start wrapping Hebrew labels.
 */
const WORKSPACE = new Set(['/settings/automations'])

export default function SettingsChrome({ nav, children }: { nav: ReactNode; children: ReactNode }) {
  const pathname = usePathname()
  // The grid and nav column follow the interface language, so the column sits on
  // the same side as the app nav. The content cell stays Hebrew until each
  // settings page is translated; the language page declares its own language.
  const { locale } = useT()
  const workspace = WORKSPACE.has(pathname)

  /**
   * MOBILE WORKSPACE: no nav column.
   *
   * `mobile:grid-cols-1` stacks the nav ABOVE the content on a phone, so every
   * settings destination opened from the mobile "עוד" hub landed the user on an
   * eighteen-item link list with the thing they asked for somewhere below the
   * fold. Tapping "אינטגרציות" and arriving at a menu is the exact navigation
   * failure this hardening pass exists to remove.
   *
   * On mobile the "עוד" hub IS this nav, so rendering it again inside every
   * settings page is duplicate navigation as well as a dead scroll. The layout
   * passes `nav={null}` for mobile-workspace requests — decided on the SERVER,
   * so a phone never receives the markup at all (architecture-rules.md §9),
   * and desktop is untouched.
   */
  const showNav = nav != null

  return (
    <div
      // Only beside the desktop nav column: the mobile shell is not translated
      // yet, so with `nav={null}` the whole chrome stays Hebrew.
      {...(showNav ? regionAttrs(locale) : {})}
      className={`grid ${showNav ? 'grid-cols-[auto_1fr] mobile:grid-cols-1 mobile:gap-4' : 'grid-cols-1'} ${
        workspace ? 'min-h-full gap-6 ps-4' : showNav ? 'gap-12 px-4' : 'px-4'
      }`}
    >
      {showNav && <div className='sticky mt-8 grid h-fit max-w-52 gap-1 mobile:max-w-full'>{nav}</div>}
      {/*
        ONE top offset for every settings page, set here so no page can drift.
        24px puts the h1 level with the nav's first item; it used to be spread
        across `(user_settings)/layout` and a handful of per-page `my-6`s, which
        is why admin pages started 24px above user ones. Pages must not add a top
        margin of their own — the first block after the header starts flush.

        אוטומציות carries the same 24px as padding inside each of its two panes
        instead. Its control centre is a full-height column: a margin here would
        start its background and hairline 24px down and leave them short at the
        bottom, so the offset has to sit inside the panes, not above them.
      */}
      <div className={workspace ? 'flex min-w-0 flex-col' : 'mt-6'} {...(showNav ? untranslatedAttrs(locale) : {})}>
        {children}
      </div>
    </div>
  )
}
