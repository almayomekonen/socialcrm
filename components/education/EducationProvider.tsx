'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  copilotYieldsToLead,
  copilotYieldsToPipeline,
  EDUCATION_ACTION_EVENT,
  getTour,
  isEducationActionId,
  isSettled,
  isTourEligible,
  isTourLockHeld,
  readState,
  recordOverviewIntro,
  markOverviewIntroEligible,
  recordTour,
  resolveEducationActionRequest,
  shouldOfferOverviewIntro,
  tourIdForAction,
  writeState,
  type Surface,
  type TourId,
  type TourStartSource,
} from '@/lib/education'
import { isAnyFirstLeadFlowActive } from '@/components/clients/firstLeadFlow'
import { recordEducationEvent } from '@/actions/education/recordEducationEvent'
import { runOverviewIntro, runTour, stopActiveTour } from './runTour'
import { openExistingAddLead } from './LeadsTourEmptyNotice'

type StartOpts = { force?: boolean; source?: TourStartSource }

type EducationApi = {
  surface: Surface
  copilotEnabled: boolean
  toursEnabled: boolean
  helpOpen: boolean
  overviewIntroOpen: boolean
  leadsTourEmptyOpen: boolean
  openHelp: () => void
  closeHelp: () => void
  startTour: (id: TourId, opts?: StartOpts) => void
  maybeStart: (id: TourId) => void
  maybeStartCopilot: (pathname: string) => void
  offerOverviewIntro: () => boolean
  markOverviewIntroEligible: () => void
  acceptOverviewIntro: () => void
  declineOverviewIntro: () => void
  settleOverviewIntro: () => void
  closeLeadsTourEmpty: () => void
  addLeadFromLeadsTourEmpty: () => void
}

const NOOP: EducationApi = {
  surface: 'desktop',
  copilotEnabled: false,
  toursEnabled: false,
  helpOpen: false,
  overviewIntroOpen: false,
  leadsTourEmptyOpen: false,
  openHelp: () => {},
  closeHelp: () => {},
  startTour: () => {},
  maybeStart: () => {},
  maybeStartCopilot: () => {},
  offerOverviewIntro: () => false,
  markOverviewIntroEligible: () => {},
  acceptOverviewIntro: () => {},
  declineOverviewIntro: () => {},
  settleOverviewIntro: () => {},
  closeLeadsTourEmpty: () => {},
  addLeadFromLeadsTourEmpty: () => {},
}

const Ctx = createContext<EducationApi>(NOOP)

export function EducationProvider({
  userId,
  surface,
  copilotEnabled,
  toursEnabled,
  children,
}: {
  userId: number
  surface: Surface
  copilotEnabled: boolean
  toursEnabled: boolean
  children: ReactNode
}) {
  const [helpOpen, setHelpOpen] = useState(false)
  const [introOpen, setIntroOpen] = useState(false)
  const [introGate, setIntroGate] = useState<'pending' | 'offering' | 'done'>('pending')
  const [leadsTourEmptyOpen, setLeadsTourEmptyOpen] = useState(false)
  const autoLaunched = useRef(false)
  const introLaunching = useRef(false)

  useEffect(() => {
    if (toursEnabled && surface === 'desktop') {
      // EducationMount stays mounted through NEVER_STARTED → TRIAL_ACTIVE.
      // While tours are disabled we close the invitation gate; when the same
      // provider later receives toursEnabled, reopen it so ProductTourHost can
      // offer after Pro celebration dismiss. Persistence still decides whether
      // anything is actually shown.
      setIntroGate((gate) => (gate === 'done' ? 'pending' : gate))
      return
    }
    setIntroOpen(false)
    setIntroGate('done')
  }, [surface, toursEnabled])

  const startTour = useCallback(
    (id: TourId, opts?: StartOpts) => {
      const def = getTour(id)
      if (!def) return
      const state = readState(userId)
      const firstLeadActive = isAnyFirstLeadFlowActive()
      const source: TourStartSource = opts?.source ?? (opts?.force ? 'help' : 'auto')
      const eligible = isTourEligible(def, {
        surface,
        toursEnabled,
        copilotEnabled,
        firstLeadActive,
        pathname: typeof window === 'undefined' ? '' : window.location.pathname,
        force: opts?.force,
        record: state.tours[id],
      })
      if (!eligible) return

      // Copilot must not steal an in-flight tour. Help / ?tour= may replace it.
      if (source === 'copilot' && isTourLockHeld()) return
      if (source !== 'copilot' && opts?.force) stopActiveTour()
      setLeadsTourEmptyOpen(false)
      autoLaunched.current = true

      void (async () => {
        const outcome = await runTour(def, {
          onEmptyWorkspace: id === 'pipeline' ? () => setLeadsTourEmptyOpen(true) : undefined,
          onStart: () => {
            recordEducationEvent('tour_started', {
              tourId: id,
              version: def.version,
              force: !!opts?.force,
              source,
            }).catch(() => {})
            if (source === 'copilot') {
              recordEducationEvent('education_tour_started_from_copilot', { tourId: id, version: def.version }).catch(
                () => {},
              )
            }
          },
          onStep: (index) => {
            recordEducationEvent('tour_step_viewed', { tourId: id, step: index }).catch(() => {})
          },
        })
        if (!outcome) {
          autoLaunched.current = false
          return
        }
        const next = recordTour(readState(userId), id, def.version, outcome.status, outcome.lastStep)
        writeState(userId, next)
        const event = outcome.status === 'completed' ? 'tour_completed' : 'tour_dismissed'
        recordEducationEvent(event, { tourId: id, version: def.version, lastStep: outcome.lastStep }).catch(() => {})
      })()
    },
    [userId, surface, toursEnabled, copilotEnabled],
  )

  useEffect(() => {
    function onAction(e: Event) {
      const action = (e as CustomEvent<{ action?: unknown }>).detail?.action
      if (!isEducationActionId(action)) return
      const firstLeadActive = isAnyFirstLeadFlowActive()
      const tourId = tourIdForAction(action)
      const def = getTour(tourId)
      const eligible = def
        ? isTourEligible(def, {
            surface,
            toursEnabled,
            copilotEnabled,
            firstLeadActive,
            pathname: window.location.pathname,
            force: true,
            record: readState(userId).tours[tourId],
          })
        : false
      const resolved = resolveEducationActionRequest(action, {
        lockHeld: isTourLockHeld(),
        eligible,
      })
      if (!resolved.ok) return
      startTour(resolved.tourId, { force: true, source: 'copilot' })
    }
    window.addEventListener(EDUCATION_ACTION_EVENT, onAction)
    return () => window.removeEventListener(EDUCATION_ACTION_EVENT, onAction)
  }, [copilotEnabled, startTour, surface, toursEnabled, userId])

  const maybeStart = useCallback(
    (id: TourId) => {
      if (introGate !== 'done' || introOpen || autoLaunched.current || helpOpen) return
      startTour(id)
    },
    [helpOpen, introGate, introOpen, startTour],
  )

  const maybeStartCopilot = useCallback(
    (pathname: string) => {
      if (introGate !== 'done' || introOpen || autoLaunched.current || helpOpen || !copilotEnabled) return
      const state = readState(userId)
      const pipeline = getTour('pipeline')
      const lead = getTour('lead')
      const pipelineSettled = pipeline ? isSettled(state.tours.pipeline, pipeline.version) : true
      const leadSettled = lead ? isSettled(state.tours.lead, lead.version) : true
      if (copilotYieldsToPipeline(pathname, pipelineSettled)) return
      if (copilotYieldsToLead(pathname, leadSettled, isAnyFirstLeadFlowActive())) return
      maybeStart('copilot')
    },
    [copilotEnabled, helpOpen, introGate, introOpen, maybeStart, userId],
  )

  const persistOverviewIntro = useCallback(
    (status: 'accepted' | 'declined') => {
      writeState(userId, recordOverviewIntro(readState(userId), status))
    },
    [userId],
  )

  const latchOverviewIntroEligible = useCallback(() => {
    if (!toursEnabled || surface !== 'desktop') return
    writeState(userId, markOverviewIntroEligible(readState(userId)))
  }, [surface, toursEnabled, userId])

  const offerOverviewIntro = useCallback(() => {
    if (introGate === 'done') return false
    if (introGate === 'offering' || introOpen || introLaunching.current) return true
    if (!toursEnabled || surface !== 'desktop') {
      setIntroGate('done')
      return false
    }
    if (helpOpen) {
      setIntroGate('done')
      return false
    }
    if (isTourLockHeld()) return false
    const overview = getTour('overview')
    if (!overview) {
      setIntroGate('done')
      return false
    }
    if (!shouldOfferOverviewIntro(readState(userId), { overviewVersion: overview.version })) {
      setIntroGate('done')
      return false
    }
    introLaunching.current = true
    setIntroOpen(true)
    setIntroGate('offering')
    recordEducationEvent('education_action_offered', { action: 'overview_intro' }).catch(() => {})
    void (async () => {
      try {
        const outcome = await runOverviewIntro()
        if (outcome === 'accepted') {
          persistOverviewIntro('accepted')
          recordEducationEvent('education_action_clicked', { action: 'overview_intro_accept' }).catch(() => {})
          setIntroOpen(false)
          setIntroGate('done')
          startTour('overview', { force: true, source: 'auto' })
          return
        }
        if (outcome === 'declined') {
          persistOverviewIntro('declined')
          recordEducationEvent('education_action_clicked', { action: 'overview_intro_decline' }).catch(() => {})
          setIntroOpen(false)
          setIntroGate('done')
          return
        }
        if (!isTourLockHeld()) {
          setIntroOpen(false)
          setIntroGate('done')
        }
      } finally {
        introLaunching.current = false
      }
    })()
    return true
  }, [helpOpen, introGate, introOpen, persistOverviewIntro, startTour, surface, toursEnabled, userId])

  const acceptOverviewIntro = useCallback(() => {
    persistOverviewIntro('accepted')
    recordEducationEvent('education_action_clicked', { action: 'overview_intro_accept' }).catch(() => {})
    setIntroOpen(false)
    setIntroGate('done')
    startTour('overview', { force: true, source: 'auto' })
  }, [persistOverviewIntro, startTour])

  const declineOverviewIntro = useCallback(() => {
    persistOverviewIntro('declined')
    recordEducationEvent('education_action_clicked', { action: 'overview_intro_decline' }).catch(() => {})
    setIntroOpen(false)
    setIntroGate('done')
  }, [persistOverviewIntro])

  const settleOverviewIntro = useCallback(() => {
    setIntroOpen(false)
    setIntroGate('done')
  }, [])

  const openHelp = useCallback(() => {
    if (introOpen) persistOverviewIntro('declined')
    setIntroOpen(false)
    setIntroGate('done')
    setLeadsTourEmptyOpen(false)
    stopActiveTour()
    setHelpOpen(true)
    recordEducationEvent('contextual_help_opened', { source: 'help_trigger' }).catch(() => {})
  }, [introOpen, persistOverviewIntro])

  const closeHelp = useCallback(() => setHelpOpen(false), [])

  const closeLeadsTourEmpty = useCallback(() => setLeadsTourEmptyOpen(false), [])

  const addLeadFromLeadsTourEmpty = useCallback(() => {
    openExistingAddLead()
    setLeadsTourEmptyOpen(false)
  }, [])

  const api = useMemo<EducationApi>(
    () => ({
      surface,
      copilotEnabled,
      toursEnabled,
      helpOpen,
      overviewIntroOpen: introOpen,
      leadsTourEmptyOpen,
      openHelp,
      closeHelp,
      startTour,
      maybeStart,
      maybeStartCopilot,
      offerOverviewIntro,
      markOverviewIntroEligible: latchOverviewIntroEligible,
      acceptOverviewIntro,
      declineOverviewIntro,
      settleOverviewIntro,
      closeLeadsTourEmpty,
      addLeadFromLeadsTourEmpty,
    }),
    [
      surface,
      copilotEnabled,
      toursEnabled,
      helpOpen,
      introOpen,
      leadsTourEmptyOpen,
      openHelp,
      closeHelp,
      startTour,
      maybeStart,
      maybeStartCopilot,
      offerOverviewIntro,
      latchOverviewIntroEligible,
      acceptOverviewIntro,
      declineOverviewIntro,
      settleOverviewIntro,
      closeLeadsTourEmpty,
      addLeadFromLeadsTourEmpty,
    ],
  )

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>
}

export function useEducation(): EducationApi {
  return useContext(Ctx)
}
