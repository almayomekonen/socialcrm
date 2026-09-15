'use client'

import type { ReactNode } from 'react'
import type { AdsSelectionQuery } from '@/lib/facebook/ads/selection'
import { useAdsSelection } from './AdsReportShell'

/**
 * Drill-down navigation (campaign → ad sets → ads, and back). A button that goes
 * through AdsReportShell, so the URL keeps the drill-down and the update shows
 * "מעדכן נתונים…" like any other change.
 */
export default function AdsDrillLink({ to, children, label }: { to: AdsSelectionQuery; children: ReactNode; label?: string }) {
  const { select } = useAdsSelection()
  return (
    <button
      type='button'
      aria-label={label}
      onClick={() => select(to)}
      className='cursor-pointer text-sm font-medium text-solid underline-offset-2 hover:underline focus-visible:rounded focus-visible:outline-2 focus-visible:outline-primary'
    >
      {children}
    </button>
  )
}
