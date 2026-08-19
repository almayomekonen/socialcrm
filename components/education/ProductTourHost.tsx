'use client'

import { useEffect } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { isTourId } from '@/lib/education'
import { useEducation } from './EducationProvider'
import HelpMenu from './HelpMenu'

/**
 * Leaf island: query-param launch, copilot auto-start, and the Help dialog.
 * Does not wrap page children — the layout stays a Server Component.
 * Target readiness lives in runTour (bounded wait), not a fixed timer here.
 */
export default function ProductTourHost() {
  const { toursEnabled, startTour, maybeStartCopilot, helpOpen, closeHelp } = useEducation()
  const search = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()
  const tourParam = search.get('tour')
  const fromParam = search.get('from')

  useEffect(() => {
    if (!toursEnabled) return
    if (!isTourId(tourParam)) return
    const source = fromParam === 'copilot' ? 'copilot' : 'query'
    startTour(tourParam, { force: true, source })
    const next = new URLSearchParams(window.location.search)
    next.delete('tour')
    if (fromParam === 'copilot') next.delete('from')
    const qs = next.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [fromParam, pathname, router, startTour, tourParam, toursEnabled])

  useEffect(() => {
    if (!toursEnabled) return
    const timer = window.setTimeout(() => maybeStartCopilot(pathname), 1200)
    return () => window.clearTimeout(timer)
  }, [toursEnabled, pathname, maybeStartCopilot])

  return helpOpen ? <HelpMenu onClose={closeHelp} /> : null
}
