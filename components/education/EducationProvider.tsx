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
  recordTour,
  resolveEducationActionRequest,
  tourIdForAction,
  writeState,
  type Surface,
  type TourId,
  type TourStartSource,
} from '@/lib/education'
import { isAnyFirstLeadFlowActive } from '@/components/clients/firstLeadFlow'
import { recordEducationEvent } from '@/actions/education/recordEducationEvent'
import { runTour, stopActiveTour } from './runTour'

type StartOpts = { force?: boolean; source?: TourStartSource }

type EducationApi = {
  surface: Surface
  copilotEnabled: boolean
  toursEnabled: boolean
  helpOpen: boolean
  openHelp: () => void
  closeHelp: () => void
  startTour: (id: TourId, opts?: StartOpts) => void
  maybeStart: (id: TourId) => void
  maybeStartCopilot: (pathname: string) => void
}

const NOOP: EducationApi = {
  surface: 'desktop',
  copilotEnabled: false,
  toursEnabled: false,
  helpOpen: false,
  openHelp: () => {},
  closeHelp: () => {},
  startTour: () => {},
  maybeStart: () => {},
  maybeStartCopilot: () => {},
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
  const autoLaunched = useRef(false)

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
      autoLaunched.current = true

      void (async () => {
        const outcome = await runTour(def, {
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
      if (autoLaunched.current || helpOpen) return
      startTour(id)
    },
    [helpOpen, startTour],
  )

  const maybeStartCopilot = useCallback(
    (pathname: string) => {
      if (autoLaunched.current || helpOpen || !copilotEnabled) return
      const state = readState(userId)
      const pipeline = getTour('pipeline')
      const lead = getTour('lead')
      const pipelineSettled = pipeline ? isSettled(state.tours.pipeline, pipeline.version) : true
      const leadSettled = lead ? isSettled(state.tours.lead, lead.version) : true
      if (copilotYieldsToPipeline(pathname, pipelineSettled)) return
      if (copilotYieldsToLead(pathname, leadSettled, isAnyFirstLeadFlowActive())) return
      maybeStart('copilot')
    },
    [copilotEnabled, helpOpen, maybeStart, userId],
  )

  const openHelp = useCallback(() => {
    stopActiveTour()
    setHelpOpen(true)
    recordEducationEvent('contextual_help_opened', { source: 'help_trigger' }).catch(() => {})
  }, [])

  const closeHelp = useCallback(() => setHelpOpen(false), [])

  const api = useMemo<EducationApi>(
    () => ({
      surface,
      copilotEnabled,
      toursEnabled,
      helpOpen,
      openHelp,
      closeHelp,
      startTour,
      maybeStart,
      maybeStartCopilot,
    }),
    [surface, copilotEnabled, toursEnabled, helpOpen, openHelp, closeHelp, startTour, maybeStart, maybeStartCopilot],
  )

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>
}

export function useEducation(): EducationApi {
  return useContext(Ctx)
}
