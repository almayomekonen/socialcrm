// @vitest-environment jsdom
//
// The CompleteRegistration conversion, after it stopped depending on the URL.
//
// THE DEFECT. The event keyed off `?welcome=`, and two redirects destroyed it:
// the (app) layout renders WorkspaceTeaser INSTEAD of {children} while the trial
// is NEVER_STARTED — which every brand-new agency is — so /leads never rendered
// its emitter until trial activation; and /activate bounces an onboarded,
// allowlisted phone to /dashboard, with redirect() dropping the query string on
// the way. No phone fired the event at all.
//
// The signal is now a cookie, read once and deleted. The load-bearing
// assertions are the ones that refuse to fire twice: this component is mounted
// unconditionally in the layout AND on /activate, so "exactly once" is the
// whole contract.
//
// No DB: `npm run test:a11y` (VITEST_NO_DB=1).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StrictMode } from 'react'
import { cleanup, render, waitFor } from '@testing-library/react'

const { trackCompleteRegistration } = vi.hoisted(() => ({
  trackCompleteRegistration: vi.fn(),
}))

vi.mock('@/lib/facebook/pixelEvents', () => ({ trackCompleteRegistration }))

import RegistrationConversion from '@/components/analytics/RegistrationConversion'

const FIRED_KEY = 'socialcrm:completeRegFired:4242'

const setCookie = (value: string) => {
  document.cookie = `scrm_reg=${value}; path=/`
}

const hasRegCookie = () => /(?:^|;\s*)scrm_reg=/.test(document.cookie)

beforeEach(() => {
  trackCompleteRegistration.mockReset()
  window.localStorage.clear()
  // jsdom keeps cookies for the life of the document; clear ours between tests.
  document.cookie = 'scrm_reg=; Max-Age=0; path=/'
})

afterEach(() => {
  cleanup()
})

describe('RegistrationConversion', () => {
  it('does nothing without the scrm_reg cookie', async () => {
    render(<RegistrationConversion />)
    // Give the effect a turn; the assertion is that it stays silent anyway.
    await waitFor(() => expect(trackCompleteRegistration).not.toHaveBeenCalled())
    expect(window.localStorage.length).toBe(0)
  })

  it('fires exactly once, marks localStorage, and deletes the cookie', async () => {
    setCookie('4242')
    render(<RegistrationConversion />)

    await waitFor(() => expect(trackCompleteRegistration).toHaveBeenCalledTimes(1))
    expect(window.localStorage.getItem(FIRED_KEY)).toBe('true')
    expect(hasRegCookie()).toBe(false)
  })

  /**
   * The shared-key case. `components/activation/RegistrationPixel.tsx` uses the
   * same `socialcrm:completeRegFired:` prefix, so on /activate — where both are
   * mounted — whichever runs first marks the id and this one must stay silent.
   * The cookie still has to go, or it re-arms on the next navigation.
   */
  it('stays silent when the id already fired, and still deletes the cookie', async () => {
    window.localStorage.setItem(FIRED_KEY, 'true')
    setCookie('4242')
    render(<RegistrationConversion />)

    await waitFor(() => expect(hasRegCookie()).toBe(false))
    expect(trackCompleteRegistration).not.toHaveBeenCalled()
  })

  /**
   * StrictMode re-runs every effect on mount in development. Without the ref
   * guard this would be two conversions per registration in dev, and one more
   * for any future effect-identity change in production.
   */
  it('fires exactly once under StrictMode double invocation', async () => {
    setCookie('4242')
    render(
      <StrictMode>
        <RegistrationConversion />
      </StrictMode>,
    )

    await waitFor(() => expect(trackCompleteRegistration).toHaveBeenCalledTimes(1))
    expect(hasRegCookie()).toBe(false)
  })
})
