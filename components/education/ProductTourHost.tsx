'use client'

import { useEffect, useRef } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { isTourId } from '@/lib/education'
import { useJustActivated } from '@/components/trial/ActivationCelebrationContext'
import { useEducation } from './EducationProvider'
import HelpMenu from './HelpMenu'
import LeadsTourEmptyNotice from './LeadsTourEmptyNotice'

/**
 * Leaf island: first-time Help spotlight invitation, query-param launch, copilot auto-start, Help.
 * Does not wrap page children — the layout stays a Server Component.
 * Target readiness lives in runTour (bounded wait), not a fixed timer here.
 */
export default function ProductTourHost() {
  const {
    toursEnabled,
    startTour,
    maybeStartCopilot,
    helpOpen,
    closeHelp,
    overviewIntroOpen,
    offerOverviewIntro,
    markOverviewIntroEligible,
    settleOverviewIntro,
    leadsTourEmptyOpen,
    closeLeadsTourEmpty,
    addLeadFromLeadsTourEmpty,
  } = useEducation()
  const justActivated = useJustActivated()
  const search = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()
  const tourParam = search.get('tour')
  const fromParam = search.get('from')
  const queryLaunchKey = useRef<string | null>(null)

  useEffect(() => {
    // Deferred, not consumed: the activation celebration owns the screen, so the
    // param is left intact and this runs again once it clears.
    if (justActivated) return
    if (!isTourId(tourParam)) return
    const key = `${tourParam}:${fromParam ?? ''}`
    if (queryLaunchKey.current === key) return
    queryLaunchKey.current = key

    /**
     * THE URL IS CLEANED WHETHER OR NOT THE TOUR RUNS.
     *
     * The cleanup used to sit after the `toursEnabled` guard, so a session that
     * could not be toured returned before reaching it and `?tour=pipeline` stuck
     * to the URL permanently — bookmarkable, shareable, and never resolving. The
     * param is a one-shot instruction: once this effect has consumed it, it is
     * spent regardless of the answer.
     */
    const next = new URLSearchParams(window.location.search)
    next.delete('tour')
    if (fromParam === 'copilot') next.delete('from')
    const qs = next.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })

    // The LAUNCH stays gated. A query-param tour is the product starting
    // something by itself, so it is not the Help exemption and fails closed.
    if (!toursEnabled) return
    settleOverviewIntro()
    const source = fromParam === 'copilot' ? 'copilot' : 'query'
    startTour(tourParam, { force: true, source })
  }, [fromParam, justActivated, pathname, router, settleOverviewIntro, startTour, tourParam, toursEnabled])

  useEffect(() => {
    if (!toursEnabled) return
    if (justActivated) {
      markOverviewIntroEligible()
      return
    }
    if (isTourId(tourParam)) return
    offerOverviewIntro()
  }, [justActivated, markOverviewIntroEligible, offerOverviewIntro, tourParam, toursEnabled])

  useEffect(() => {
    if (!toursEnabled || overviewIntroOpen || justActivated) return
    const timer = window.setTimeout(() => maybeStartCopilot(pathname), 1200)
    return () => window.clearTimeout(timer)
  }, [justActivated, maybeStartCopilot, overviewIntroOpen, pathname, toursEnabled])

  return (
    <>
      {helpOpen ? <HelpMenu onClose={closeHelp} /> : null}
      {leadsTourEmptyOpen ? (
        <LeadsTourEmptyNotice onDismiss={closeLeadsTourEmpty} onAddLead={addLeadFromLeadsTourEmpty} />
      ) : null}
    </>
  )
}
