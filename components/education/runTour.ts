'use client'

import { acquireTourLock, presentSteps, waitForTourTargets, releaseTourLock } from '@/lib/education'
import type { TourDefinition, TourStatus } from '@/lib/education/types'

export type TourOutcome = {
  status: TourStatus
  lastStep: number
}

type Hooks = {
  onStart?: () => void
  onStep?: (index: number) => void
}

let destroyActive: (() => void) | null = null

export function stopActiveTour(): void {
  destroyActive?.()
}

export async function runTour(def: TourDefinition, hooks: Hooks = {}): Promise<TourOutcome | null> {
  if (typeof window === 'undefined') return null

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
    // Load library CSS first, then the SocialCRM skin so edu-popover wins the cascade.
    const mod = await import('driver.js')
    await import('driver.js/dist/driver.css')
    await import('@/lib/css/education.css')
    driverFn = mod.driver
  } catch {
    releaseTourLock()
    return null
  }

  return new Promise((resolve) => {
    const instance = driverFn({
      animate: !reduceMotion,
      smoothScroll: !reduceMotion,
      allowClose: true,
      allowKeyboardControl: true,
      allowScroll: true,
      overlayColor: '#0a2540',
      overlayOpacity: 0.45,
      overlayClickBehavior: 'close',
      stagePadding: 8,
      stageRadius: 12,
      popoverOffset: 12,
      popoverClass: 'edu-popover',
      showProgress: true,
      progressText: '{{current}} of {{total}}',
      nextBtnText: 'Next',
      prevBtnText: 'Back',
      doneBtnText: 'Got it',
      skipMissingElement: true,
      disableActiveInteraction: false,
      steps: steps.map((step) => ({
        element: step.element,
        popover: {
          title: step.title,
          description: step.description,
          side: step.side,
          align: step.align,
          popoverClass: 'edu-popover',
        },
      })),
      onPopoverRender: (popover) => {
        popover.wrapper.setAttribute('dir', 'ltr')
        popover.wrapper.setAttribute('role', 'dialog')
        popover.wrapper.setAttribute('aria-modal', 'true')
        popover.wrapper.setAttribute('aria-label', popover.title.textContent || 'Guided tour')
        const skip = document.createElement('button')
        skip.type = 'button'
        skip.className = 'edu-popover-skip'
        skip.textContent = 'Skip'
        skip.addEventListener('click', () => finish('dismissed'))
        popover.footerButtons.appendChild(skip)
      },
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
