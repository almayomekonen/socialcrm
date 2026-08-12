'use client'

import type { ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import Icon from '@/lib/Icon'

/**
 * The mobile screen header — one title, an optional back affordance, one
 * optional trailing action.
 *
 * Deliberately NOT a port of `Topbar`. Topbar carries the logo, the PRO pill,
 * the trial counter, the notification bell and the account menu; reproducing
 * that on a 360px screen would spend the whole header on chrome. Here the title
 * is the orientation and the tab bar is the navigation, so the header only has
 * to answer "where am I" and "how do I get back".
 *
 * RTL: the back arrow points RIGHT. The document is `dir='rtl'`, so "where I
 * came from" is the right edge — `arrow-right` is authored correct here and must
 * NOT be flipped. (There is no global RTL icon-mirroring rule in the stylesheet;
 * the scattered `rtl:scale-x-100` classes are identity no-ops.)
 *
 * Sticky, not fixed — a fixed header needs the scroll container to carry
 * matching padding, and every screen forgetting it is a clipped first row.
 */
export default function MobileHeader({
  title,
  subtitle,
  onBack,
  backLabel = 'חזרה',
  action,
}: {
  title: string
  subtitle?: string
  /**
   * Omit for top-level tab screens (Today/Leads/Notifications) — they are
   * destinations, not a stack, so a back arrow there points nowhere meaningful.
   * Pass `true` to use browser history, or a function for an explicit target.
   */
  onBack?: true | (() => void)
  backLabel?: string
  /** One trailing control. More than one belongs in a bottom sheet. */
  action?: ReactNode
}) {
  const router = useRouter()
  const handleBack = onBack === true ? () => router.back() : onBack

  return (
    <header
      className='sticky top-0 z-40 shrink-0 border-b border-gray-200 bg-white pt-[env(safe-area-inset-top,0px)]'
      data-mobile-header
    >
      <div className='flex min-h-14 items-center gap-2 px-3'>
        {handleBack && (
          <button
            type='button'
            onClick={handleBack}
            aria-label={backLabel}
            className='flex size-11 shrink-0 items-center justify-center rounded-full text-gray-600 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
          >
            <Icon name='arrow-right' type='sol' className='size-5 bg-gray-600' />
          </button>
        )}

        <div className='min-w-0 flex-1'>
          {/* truncate, not wrap: a two-line header pushes the content down on
              every screen to accommodate the longest lead name. */}
          <h1 className='truncate text-base font-bold leading-tight text-ink'>{title}</h1>
          {subtitle && <p className='truncate text-xs leading-tight text-gray-500'>{subtitle}</p>}
        </div>

        {action && <div className='flex shrink-0 items-center'>{action}</div>}
      </div>
    </header>
  )
}
