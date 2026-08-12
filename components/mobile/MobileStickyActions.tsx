'use client'

import type { ReactNode } from 'react'

/**
 * The sticky bottom action bar — the primary action of a mobile screen, pinned
 * where the thumb already is.
 *
 * `ux-guidelines.md` §5 and the plan's rule #15 both require exactly one primary
 * action per screen; this is where it lives on mobile. Secondary actions may sit
 * beside it, but they take a lower-weight variant so the pair never reads as two
 * primaries.
 *
 * SAFE AREA IS THE WHOLE POINT. An action bar flush to the viewport bottom on a
 * notched phone puts the primary button under the home indicator, where the OS
 * swipe wins the gesture and the tap simply does not register. The padding is
 * applied to the bar (background extends under the indicator) while the controls
 * stay above it.
 *
 * STACKING: `z-30`, deliberately below `MobileHeader` (z-40) and the tab bar
 * (z-50), and far below ModalPop's portal (z-99999) — a sheet must cover the
 * action bar, never the reverse.
 */
export default function MobileStickyActions({
  children,
  /**
   * Set when this bar renders on a screen that also shows `MobileTabBar`. The
   * tab bar already pays the safe-area inset, so paying it twice leaves a
   * visible dead strip under the buttons.
   */
  aboveTabBar = false,
  className = '',
}: {
  children: ReactNode
  aboveTabBar?: boolean
  className?: string
}) {
  return (
    <div
      data-mobile-sticky-actions
      className={`sticky bottom-0 z-30 shrink-0 border-t border-gray-200 bg-white px-4 pt-3 ${
        aboveTabBar ? 'pb-3' : 'pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)]'
      } ${className}`}
    >
      {/* Children lay themselves out; the bar only owns placement and safety.
          Buttons passed here should use size='large' (h-11 = 44px). */}
      <div className='flex items-center gap-2'>{children}</div>
    </div>
  )
}
