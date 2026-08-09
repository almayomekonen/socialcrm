'use client'

import type { ReactNode } from 'react'
import { usePathname } from 'next/navigation'

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
  const workspace = WORKSPACE.has(pathname)

  return (
    <div
      className={`grid grid-cols-[auto_1fr] mobile:grid-cols-1 mobile:gap-4 ${
        workspace ? 'min-h-full gap-6 ps-4' : 'gap-12 px-4'
      }`}
    >
      <div className='sticky mt-8 grid h-fit max-w-52 gap-1 mobile:max-w-full'>{nav}</div>
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
      <div className={workspace ? 'flex min-w-0 flex-col' : 'mt-6'}>{children}</div>
    </div>
  )
}
