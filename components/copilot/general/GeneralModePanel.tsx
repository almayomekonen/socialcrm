'use client'

import { useEffect, useRef } from 'react'
import { recordGeneralModeEvent } from '@/actions/analytics/recordGeneralModeEvent'

/**
 * Phase 0 scaffold for the no-lead "General Mode" surface. Renders an empty
 * shell that matches the panel's outer layout and fires a single `opened`
 * analytics event. Phase 1 fills this with the Daily Briefing, bounded Q&A,
 * and the empty-state onboarding.
 *
 * This component only ever mounts when General Mode is enabled AND no lead
 * context is published (see CopilotShell), so it cannot affect Lead Mode.
 */
export default function GeneralModePanel() {
  const firedRef = useRef(false)

  useEffect(() => {
    if (firedRef.current) return
    firedRef.current = true
    void recordGeneralModeEvent('general_mode.opened')
  }, [])

  return (
    <div className='h-full flex flex-col items-stretch'>
      <div className='flex-1 overflow-hidden px-3' />
    </div>
  )
}
