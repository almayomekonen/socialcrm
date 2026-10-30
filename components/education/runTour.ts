'use client'

import {
  acquireTourLock,
  eduSel,
  HELP_TRIGGER_EDU,
  presentSteps,
  waitForLeadsWorkspaceEmpty,
  waitForTourTargets,
  releaseTourLock,
} from '@/lib/education'
import type { TourDefinition, TourStatus } from '@/lib/education/types'
import { introCopy, localizeTourSteps, tourChrome } from '@/lib/education/tourCopy'
import { baseDriverConfig, decorateTourPopover } from './tourPopover'
import { tourTranslator } from './tourLanguage'

export type TourOutcome = {
  status: TourStatus
  lastStep: number
}

export type OverviewIntroOutcome = 'accepted' | 'declined'

type Hooks = {
  onStart?: () => void
  onStep?: (index: number) => void
  /** Leads workspace has zero leads — do not start Driver.js. */
  onEmptyWorkspace?: () => void
}

let destroyActive: (() => void) | null = null

export function stopActiveTour(): void {
  destroyActive?.()
}

async function loadDriver() {
  // Load library CSS first, then the SocialCRM skin so edu-popover wins the cascade.
  const mod = await import('driver.js')
  await import('driver.js/dist/driver.css')
  await import('@/lib/css/education.css')
  return mod.driver
}

export async function runTour(def: TourDefinition, hooks: Hooks = {}): Promise<TourOutcome | null> {
  if (typeof window === 'undefined') return null

  if (def.id === 'pipeline' && window.location.pathname.startsWith('/leads')) {
    const empty = await waitForLeadsWorkspaceEmpty()
    if (empty) {
      hooks.onEmptyWorkspace?.()
      return null
    }
  }

  const ready = await waitForTourTargets(def.steps)
  if (!ready) return null

  const steps = presentSteps(def.steps)
  if (steps.length === 0) return null
  if (!acquireTourLock()) return null

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  let status: TourStatus = 'dismissed'
  let lastStep = 0
  let settled = false

  let driverFn: (typeof import('driver.js'))['driver']
  try {
    driverFn = await loadDriver()
  } catch {
    releaseTourLock()
    return null
  }

  // The interface language, read when the popover is built (tourLanguage.ts).
  // Hebrew: the registry's own steps and the Hebrew catalog chrome.
  const t = tourTranslator()
  const chrome = tourChrome(t)
  const shown = localizeTourSteps(def.id, steps, t)

  return new Promise((resolve) => {
    const instance = driverFn({
      ...baseDriverConfig(reduceMotion),
      popoverClass: 'edu-popover',
      showProgress: true,
      progressText: chrome.progressText,
      nextBtnText: chrome.nextBtnText,
      prevBtnText: chrome.prevBtnText,
      doneBtnText: chrome.doneBtnText,
      skipMissingElement: true,
      disableActiveInteraction: false,
      steps: shown.map((step) => ({
        element: step.element,
        popover: {
          title: step.title,
          description: step.description,
          side: step.side,
          align: step.align,
          popoverClass: 'edu-popover',
        },
      })),
      onPopoverRender: (popover) =>
        decorateTourPopover(popover, {
          label: popover.title.textContent || chrome.fallbackLabel,
          extra: { text: chrome.skip, onClick: () => finish('dismissed') },
          t,
        }),
      onHighlightStarted: (_el, _step, { index }) => {
        lastStep = index ?? 0
        hooks.onStep?.(lastStep)
      },
      onNextClick: (_el, _step, { driver: d }) => {
        if (d.isLastStep()) finish('completed')
        else d.moveNext()
      },
      onPrevClick: (_el, _step, { driver: d }) => d.movePrevious(),
      onCloseClick: () => finish('dismissed'),
      onDoneClick: () => finish('completed'),
      onDestroyed: () => {
        destroyActive = null
        releaseTourLock()
        resolve({ status, lastStep })
      },
    })

    function finish(next: TourStatus) {
      if (settled) return
      settled = true
      status = next
      lastStep = instance.getActiveIndex() ?? lastStep
      instance.destroy()
    }

    destroyActive = () => finish('dismissed')
    hooks.onStart?.()
    instance.drive(0)
  })
}

/**
 * One-step Help-button spotlight. Not a TourId and not Overview step 0.
 * Shares tourLock / destroyActive with runTour so two Driver.js instances
 * cannot run at once. Does not call stopActiveTour — if the lock is held, this
 * returns null and the active tour is left alone.
 */
export async function runOverviewIntro(): Promise<OverviewIntroOutcome | null> {
  if (typeof window === 'undefined') return null

  // Only the target matters until the popover is built; its words are `introCopy`.
  const steps = [
    {
      element: eduSel(HELP_TRIGGER_EDU),
      title: '',
      description: '',
      side: 'bottom' as const,
      align: 'end' as const,
    },
  ]

  const ready = await waitForTourTargets(steps)
  if (!ready) return null
  if (presentSteps(steps).length === 0) return null
  if (!acquireTourLock()) return null

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  let status: OverviewIntroOutcome = 'declined'
  let settled = false

  let driverFn: (typeof import('driver.js'))['driver']
  try {
    driverFn = await loadDriver()
  } catch {
    releaseTourLock()
    return null
  }

  const t = tourTranslator()
  const copy = introCopy(t)
  // Driver.js still renders a progress line and a back button the intro's CSS
  // hides; outside Hebrew they get the interface words too (Hebrew: unchanged).
  const hidden = t.locale === 'he' ? {} : { progressText: tourChrome(t).progressText, prevBtnText: tourChrome(t).prevBtnText }

  return new Promise((resolve) => {
    const instance = driverFn({
      ...baseDriverConfig(reduceMotion),
      popoverClass: 'edu-popover edu-popover-intro',
      showProgress: false,
      showButtons: ['next'],
      nextBtnText: copy.start,
      doneBtnText: copy.start,
      ...hidden,
      skipMissingElement: true,
      disableActiveInteraction: true,
      steps: [
        {
          element: steps[0].element,
          popover: {
            title: copy.title,
            description: copy.description,
            side: steps[0].side,
            align: steps[0].align,
            popoverClass: 'edu-popover edu-popover-intro',
            showProgress: false,
            showButtons: ['next'],
            doneBtnText: copy.start,
            nextBtnText: copy.start,
          },
        },
      ],
      onPopoverRender: (popover) =>
        decorateTourPopover(popover, {
          label: copy.title,
          extra: { text: copy.later, onClick: () => finish('declined') },
          t,
        }),
      onNextClick: () => finish('accepted'),
      onDoneClick: () => finish('accepted'),
      onCloseClick: () => finish('declined'),
      onDestroyed: () => {
        destroyActive = null
        releaseTourLock()
        resolve(status)
      },
    })

    function finish(next: OverviewIntroOutcome) {
      if (settled) return
      settled = true
      status = next
      instance.destroy()
    }

    destroyActive = () => finish('declined')
    instance.drive(0)
  })
}
