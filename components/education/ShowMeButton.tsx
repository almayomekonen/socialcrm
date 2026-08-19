'use client'

import { usePathname, useRouter } from 'next/navigation'
import { recordEducationEvent } from '@/actions/education/recordEducationEvent'
import {
  isEducationActionId,
  isTourLockHeld,
  navigationHrefForAction,
  requestEducationAction,
} from '@/lib/education'

/**
 * Copilot CTA for an allowlisted education action. Does not import Driver.js;
 * it only asks the education layer to start a registered tour.
 */
export default function ShowMeButton({ action, disabled = false }: { action: string; disabled?: boolean }) {
  const router = useRouter()
  const pathname = usePathname()

  if (!isEducationActionId(action)) return null
  const allowed = action

  function onClick() {
    if (disabled) return
    if (isTourLockHeld()) return
    recordEducationEvent('education_action_clicked', { action: allowed }).catch(() => {})

    if (allowed === 'open_lead_tour' && !pathname.startsWith('/clients/')) {
      router.push('/leads')
      return
    }

    const href = navigationHrefForAction(allowed, pathname)
    if (href) {
      router.push(href)
      return
    }

    requestEducationAction(allowed)
  }

  return (
    <button
      type='button'
      onClick={onClick}
      disabled={disabled}
      aria-label='Show me — start the guided tour'
      className='rounded-full border border-gray-200 px-2.5 py-1 text-[12px] text-gray-700 transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent'
    >
      Show me
    </button>
  )
}
