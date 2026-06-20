'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { recordGeneralModeEvent } from '@/actions/analytics/recordGeneralModeEvent'

/**
 * A navigation link that records a `deeplink_clicked` analytics event (the
 * action half of the General-Mode funnel) before navigating. Analytics is
 * fire-and-forget and never blocks navigation.
 */
export default function DeepLink({
  href,
  source,
  className,
  children,
}: {
  href: string
  source: string
  className?: string
  children: ReactNode
}) {
  return (
    <Link
      href={href}
      className={className}
      onClick={() => void recordGeneralModeEvent('general_mode.deeplink_clicked', { source, target: href })}
    >
      {children}
    </Link>
  )
}
