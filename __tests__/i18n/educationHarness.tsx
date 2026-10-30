/**
 * Shared helpers for the education (product tour) i18n tests: the REAL
 * Driver.js runs in jsdom (its CSS is mocked by the caller), every tour target
 * is mounted as a plain element, and each tour is walked step by step through
 * its own buttons. Used by the Hebrew baseline and by the locale tests.
 */
import { expect } from 'vitest'
import { act, fireEvent, waitFor } from '@testing-library/react'
import { OVERVIEW_NAV_TARGETS } from '@/lib/education/types'
import type { TourDefinition } from '@/lib/education/types'

/** Every `data-edu` target any registered tour (or the Help spotlight) points at. */
export const TOUR_TARGETS = [
  ...OVERVIEW_NAV_TARGETS.map((t) => t.id),
  'header',
  'copilot-trigger',
  'notifications',
  'leads-table',
  'lead-status-tabs',
  'lead-open',
  'leads-add',
  'lead-status',
  'lead-followup',
  'whatsapp-section',
  'whatsapp-connect',
  'facebook-section',
  'facebook-connect',
  'help-trigger',
] as const

export function mountTourTargets(): void {
  document.body.insertAdjacentHTML(
    'beforeend',
    TOUR_TARGETS.map((id) => `<div data-edu="${id}">${id}</div>`).join(''),
  )
}

/** Reduced motion: Driver.js renders synchronously, without its animation frames. */
export function reduceMotion(): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: () => ({ matches: true, addListener: () => {}, removeListener: () => {} }),
  })
}

export function popover(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.driver-popover')
}

/** The popover as rendered, minus Driver.js's computed position (jsdom layout, not text). */
export function popoverHtml(): string {
  const el = popover()
  if (!el) return '(no popover)'
  const clone = el.cloneNode(true) as HTMLElement
  clone.removeAttribute('style')
  clone.querySelectorAll('[style]').forEach((n) => n.removeAttribute('style'))
  return clone.outerHTML
}

/**
 * Driver.js records the highlighted element on its next animation frame and
 * only reports `onDestroyed` once it has; a person can never click sooner.
 */
export async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 40))
  })
}

/**
 * Start `run`, record the popover at every step by pressing the next button,
 * and return the recorded steps with the outcome. The last press is the
 * "done" button of the last step.
 */
export async function walkTour<T>(start: () => Promise<T>, stepCount: number): Promise<{ steps: string[]; outcome: T }> {
  const pending = start()
  await waitFor(() => expect(popover()).not.toBeNull(), { timeout: 3000 })
  const steps: string[] = []
  for (let i = 0; i < stepCount; i++) {
    await settle()
    steps.push(popoverHtml())
    const next = popover()?.querySelector<HTMLElement>('.driver-popover-next-btn')
    if (!next) throw new Error(`step ${i}: no next button`)
    fireEvent.click(next)
  }
  const outcome = await pending
  return { steps, outcome }
}

/** Start a tour and dismiss it at the first step with the extra footer button (skip / later). */
export async function dismissWithFooterButton<T>(start: () => Promise<T>): Promise<{ html: string; outcome: T }> {
  const pending = start()
  await waitFor(() => expect(popover()).not.toBeNull(), { timeout: 3000 })
  await settle()
  const html = popoverHtml()
  const skip = popover()?.querySelector<HTMLElement>('.edu-popover-skip')
  if (!skip) throw new Error('no footer button')
  fireEvent.click(skip)
  return { html, outcome: await pending }
}

export function presentStepCount(def: TourDefinition): number {
  return def.steps.length
}
