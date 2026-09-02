// @vitest-environment jsdom
//
// Regression guard for EC-16 — the trial must be startable from every surface
// that can reach the app.
//
// The (app) layout is the ONE device gate: it redirects phones to /activate
// (isMobileRequest, lib/device.ts) before this modal ever renders. A second,
// client-side viewport gate used to live inside the modal itself
// (`matchMedia('(min-width: 1000px)')`), and the two disagreed: a tablet or a
// narrow desktop window passes the UA-based server gate but failed the viewport
// check. The modal never opened, startTrial() was unreachable, and the agency
// sat inside the product silently capped at FREE_LEAD_LIMIT with no way out and
// no explanation.
//
// The invariant locked in below is therefore stronger than "the modal opens":
// this component must never consult the viewport at all. Device gating belongs
// to the server (architecture-rules.md §9 — gate by absence, never suppress on
// the client).
//
// Runs without a database:
//   NODE_ENV=test VITEST_NO_DB=1 npx vitest run __tests__/trial

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

vi.mock('@/actions/trial', () => ({
  startTrial: vi.fn(async () => ({ ok: true, started: true })),
  trackWelcomeModalSeen: vi.fn(async () => ({ ok: true })),
  trackTrialStartClicked: vi.fn(async () => {}),
  trackTrialStartFailed: vi.fn(async () => {}),
}))

import WelcomeTrialModal from '@/components/trial/WelcomeTrialModal'
import { ActivationCelebrationProvider } from '@/components/trial/ActivationCelebrationContext'
import { startTrial, trackTrialStartClicked, trackTrialStartFailed, trackWelcomeModalSeen } from '@/actions/trial'

/**
 * Rendered inside the REAL celebration provider rather than a mock: the modal
 * calls markActivated() on a genuine activation, and useActivationCelebration
 * throws outside a provider. Using the real one keeps this test honest about
 * the integration instead of asserting against a stub.
 */
function renderModal() {
  return render(
    <ActivationCelebrationProvider>
      <WelcomeTrialModal />
    </ActivationCelebrationProvider>,
  )
}

/**
 * Deliberately NOT asserted against exact copy. This suite is about whether the
 * trial is reachable, not about what the modal says — pinning marketing strings
 * here would make copy edits look like reachability regressions. The dialog is
 * unique on screen, and `hideClose` means its CTA is the only button in it.
 */
const dialog = () => screen.queryByRole('dialog')
const cta = () => screen.getByRole('button')

/**
 * A viewport probe that reports "narrow" for every query — the exact condition
 * that used to suppress the modal. It also records every call, so the tests can
 * assert the component does not consult it at all.
 */
function installNarrowViewportProbe() {
  const probe = vi.fn((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
  Object.defineProperty(window, 'matchMedia', { writable: true, configurable: true, value: probe })
  return probe
}

describe('WelcomeTrialModal — trial reachability (EC-16)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(cleanup)

  test('opens on a narrow viewport — the tablet / small-window hole is closed', async () => {
    installNarrowViewportProbe()
    renderModal()
    await waitFor(() => expect(dialog()).toBeTruthy())
    // It must also still be a NAMED dialog — reachability is not an excuse to
    // lose the accessible name.
    expect(dialog()!.getAttribute('aria-labelledby')).toBeTruthy()
  })

  test('never consults the viewport — device gating stays the server\'s job', async () => {
    const probe = installNarrowViewportProbe()
    renderModal()
    await waitFor(() => expect(dialog()).toBeTruthy())
    expect(probe).not.toHaveBeenCalled()
  })

  test('the trial-start path is reachable: CTA calls startTrial and the modal closes', async () => {
    installNarrowViewportProbe()
    renderModal()
    await waitFor(() => expect(dialog()).toBeTruthy())

    fireEvent.click(cta())

    await waitFor(() => expect(startTrial).toHaveBeenCalledTimes(1))
    // done → open=false → the non-dismissible dialog unmounts, releasing the user
    // into the workspace with an active trial.
    await waitFor(() => expect(dialog()).toBeNull())
  })

  test('funnel events fire once on open, not once per render', async () => {
    installNarrowViewportProbe()
    const { rerender } = renderModal()
    await waitFor(() => expect(dialog()).toBeTruthy())
    rerender(
      <ActivationCelebrationProvider>
        <WelcomeTrialModal />
      </ActivationCelebrationProvider>,
    )
    expect(trackWelcomeModalSeen).toHaveBeenCalledTimes(1)
  })
})

/**
 * Observability of the CTA — added after agency 132 registered, saw the modal,
 * and never started a trial, with no way to tell whether they walked away or
 * pressed the button and it failed. The modal is non-dismissible, so those are
 * the only two possibilities and only telemetry can separate them.
 */
describe('trial-start observability', () => {
  // Call counts are asserted exactly, and the module mock is shared across the
  // file. Scoped here so the existing suite's setup is left untouched.
  beforeEach(() => vi.clearAllMocks())

  test('modal shown is recorded on mount', async () => {
    renderModal()
    await waitFor(() => expect(trackWelcomeModalSeen).toHaveBeenCalled())
  })

  test('pressing the CTA records the click', async () => {
    renderModal()
    fireEvent.click(await screen.findByRole('button'))
    await waitFor(() => expect(trackTrialStartClicked).toHaveBeenCalledTimes(1))
  })

  test('a successful start records the click and no failure', async () => {
    vi.mocked(startTrial).mockResolvedValueOnce({ ok: true, started: true } as never)
    renderModal()
    fireEvent.click(await screen.findByRole('button'))
    await waitFor(() => expect(startTrial).toHaveBeenCalled())
    expect(trackTrialStartClicked).toHaveBeenCalledTimes(1)
    expect(trackTrialStartFailed).not.toHaveBeenCalled()
  })

  test('a rejected start records the failure with its category', async () => {
    vi.mocked(startTrial).mockResolvedValueOnce({ error: 'unauthorized' } as never)
    renderModal()
    fireEvent.click(await screen.findByRole('button'))
    await waitFor(() => expect(trackTrialStartFailed).toHaveBeenCalledWith('unauthorized'))
    expect(trackTrialStartClicked).toHaveBeenCalledTimes(1)
  })

  test('a thrown start is recorded as a network failure', async () => {
    vi.mocked(startTrial).mockRejectedValueOnce(new Error('boom'))
    renderModal()
    fireEvent.click(await screen.findByRole('button'))
    await waitFor(() => expect(trackTrialStartFailed).toHaveBeenCalledWith('network'))
  })

  test('double-clicking cannot inflate the click count', async () => {
    renderModal()
    const cta = await screen.findByRole('button')
    fireEvent.click(cta)
    fireEvent.click(cta)
    await waitFor(() => expect(startTrial).toHaveBeenCalledTimes(1))
    expect(trackTrialStartClicked).toHaveBeenCalledTimes(1)
  })

  test('telemetry failure never blocks the only way out of the modal', async () => {
    vi.mocked(trackTrialStartClicked).mockRejectedValueOnce(new Error('analytics down'))
    renderModal()
    fireEvent.click(await screen.findByRole('button'))
    await waitFor(() => expect(startTrial).toHaveBeenCalled())
  })
})
