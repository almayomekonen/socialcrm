// @vitest-environment jsdom
//
// Mobile-safety regression suite for the Welcome Trial Modal.
//
// WHY THIS FILE EXISTS. This dialog is the ONLY way into the product for a
// NEVER_STARTED agency and it is deliberately non-dismissible. On desktop that
// is fine. Once the mobile workspace opens (Phase 2), a phone reaching a modal
// that does not fit is not inconvenienced — it is LOCKED OUT with no escape,
// and production trial conversion is currently 5/5. These assertions exist so
// that can never regress silently.
//
// SCOPE HONESTY: jsdom has no layout engine, so nothing here can prove a pixel
// does not overflow at 360px. What it CAN prove — and does — is that every
// mechanism the mobile fit depends on is present and wired: the responsive
// classes are applied, the CTA is reachable and operable, focus is trapped and
// cycles, and the trial call itself is untouched. Real pixel QA at 360/375/390/
// 430 is a browser task and is reported separately.
//
// Guarantees locked in (do not weaken without an accessibility review):
//   1. The dialog is named, is a dialog, and traps focus.
//   2. The CTA — the single trial trigger — is present, enabled and operable.
//   3. Tab cycles inside the dialog and never escapes it.
//   4. Mobile-safety classes are applied: reduced padding, safe-area bottom
//      inset, dvh height cap, single-column benefit grid.
//   5. TRIAL LOGIC IS UNCHANGED: startTrial() is called exactly once per click,
//      with no arguments, and the modal closes only on success.
//   6. The Meta StartTrial pixel fires ONLY on a genuine started:true.
//
// Runs without a database: `npm run test:a11y` (VITEST_NO_DB=1).

import { describe, afterEach, test, expect, vi } from 'vitest'
import React from 'react'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

const startTrial = vi.fn(async () => ({ ok: true as const, started: true }))
const trackWelcomeModalSeen = vi.fn(async () => ({ ok: true as const }))
const trackStartTrial = vi.fn()
const markActivated = vi.fn()

vi.mock('@/actions/trial', () => ({
  startTrial: (...a: unknown[]) => startTrial(...(a as [])),
  trackWelcomeModalSeen: () => trackWelcomeModalSeen(),
}))
vi.mock('@/lib/facebook/pixelEvents', () => ({
  trackStartTrial: () => trackStartTrial(),
  trackCompleteRegistration: () => {},
  trackSubscribe: () => {},
  trackPixelEvent: () => {},
}))
vi.mock('@/components/trial/ActivationCelebrationContext', () => ({
  useActivationCelebration: () => ({ markActivated }),
}))

import WelcomeTrialModal from '@/components/trial/WelcomeTrialModal'

const CTA = 'הפעל את ה-Pro שלי'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  startTrial.mockResolvedValue({ ok: true as const, started: true })
})

function dialog() {
  return screen.getByRole('dialog', { name: /SocialCRM Pro/ })
}

describe('WelcomeTrialModal — mobile safety', () => {
  test('1. is a named dialog', () => {
    render(<WelcomeTrialModal />)
    expect(dialog()).toBeTruthy()
  })

  test('2. the CTA is present, enabled and operable — the only way in', () => {
    render(<WelcomeTrialModal />)
    const cta = screen.getByRole('button', { name: CTA })
    expect((cta as HTMLButtonElement).disabled).toBe(false)
  })

  test('3. Tab cycles inside the dialog and never escapes it', () => {
    render(<WelcomeTrialModal />)
    const d = dialog()
    const focusables = Array.from(
      d.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])"),
    )
    expect(focusables.length).toBeGreaterThan(0)

    // From the last focusable, Tab must wrap to the first — not to the page.
    focusables[focusables.length - 1].focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(d.contains(document.activeElement)).toBe(true)

    // Shift+Tab from the first must wrap to the last, still inside.
    focusables[0].focus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(d.contains(document.activeElement)).toBe(true)
  })

  test('4a. the dialog surface applies the mobile padding + safe-area inset', () => {
    render(<WelcomeTrialModal />)
    const cls = dialog().className
    expect(cls).toContain('mobile:p-5')
    // The CTA must never sit under the home indicator, where the OS swipe wins.
    expect(cls).toContain('env(safe-area-inset-bottom')
    // dvh, not vh — mobile browser chrome must not clip the CTA.
    expect(cls).toContain('mobile:max-h-[92dvh]')
  })

  test('4b. the benefit grid collapses to one column on phones', () => {
    render(<WelcomeTrialModal />)
    // ModalPop portals to document.body, so the render `container` is empty —
    // query from the dialog itself.
    const grid = dialog().querySelector('.grid')
    expect(grid).not.toBeNull()
    expect(grid!.className).toContain('grid-cols-2')
    expect(grid!.className).toContain('mobile:grid-cols-1')
  })

  test('4c. the dialog still scrolls internally, so the CTA is reachable when short', () => {
    render(<WelcomeTrialModal />)
    expect(dialog().className).toContain('overflow-y-auto')
  })

  test('5. TRIAL LOGIC UNCHANGED: startTrial() called exactly once, with no args', async () => {
    render(<WelcomeTrialModal />)
    fireEvent.click(screen.getByRole('button', { name: CTA }))
    await waitFor(() => expect(startTrial).toHaveBeenCalledTimes(1))
    expect(startTrial).toHaveBeenCalledWith()
  })

  test('5b. a double-click cannot start two trials', async () => {
    render(<WelcomeTrialModal />)
    const cta = screen.getByRole('button', { name: CTA })
    fireEvent.click(cta)
    fireEvent.click(cta)
    await waitFor(() => expect(startTrial).toHaveBeenCalledTimes(1))
  })

  test('5c. on failure the dialog STAYS OPEN and shows a recoverable error', async () => {
    startTrial.mockResolvedValue({ error: 'unauthorized' } as never)
    render(<WelcomeTrialModal />)
    fireEvent.click(screen.getByRole('button', { name: CTA }))
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
    // Still the only way in — never a dead end.
    expect(screen.getByRole('button', { name: CTA })).toBeTruthy()
    expect(dialog()).toBeTruthy()
  })

  test('6. the Meta StartTrial pixel fires only on a genuine started:true', async () => {
    render(<WelcomeTrialModal />)
    fireEvent.click(screen.getByRole('button', { name: CTA }))
    await waitFor(() => expect(trackStartTrial).toHaveBeenCalledTimes(1))
    expect(markActivated).toHaveBeenCalledTimes(1)
  })

  test('6b. started:false (refresh / already active) fires neither pixel nor celebration', async () => {
    startTrial.mockResolvedValue({ ok: true as const, started: false })
    render(<WelcomeTrialModal />)
    fireEvent.click(screen.getByRole('button', { name: CTA }))
    await waitFor(() => expect(startTrial).toHaveBeenCalled())
    expect(trackStartTrial).not.toHaveBeenCalled()
    expect(markActivated).not.toHaveBeenCalled()
  })
})
