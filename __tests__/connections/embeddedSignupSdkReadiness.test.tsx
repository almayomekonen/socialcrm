// @vitest-environment jsdom
/**
 * Facebook SDK initialisation race in `useEmbeddedSignup`.
 *
 * Observed live on 2026-08-30: the operator clicked the Coexistence button once,
 * it changed to "מתחבר...", no Meta popup ever opened, and it stayed that way.
 * `/api/whatsapp/embedded-signup` was never reached.
 *
 * Cause: `launch` guarded on `if (!window.FB)` — SDK *presence*, not SDK
 * *initialisation*. Between sdk.js executing and `fbAsyncInit` running there is a
 * window where `window.FB` is truthy but `FB.init()` has not been called, and
 * `FB.login` on an uninitialised SDK opens nothing and never invokes its
 * callback. Every `resolve` lives inside that callback, so the promise never
 * settled and `useAction`'s `finally` never cleared the loading state.
 *
 * Two further holes fed the same failure: `window.fbAsyncInit` was assigned only
 * on the not-yet-loaded branch, and the script tag was only re-examined via
 * `getElementById`, so a tag that already existed with init still pending left
 * nothing registered to ever run init.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('@/lib/facebook/embeddedSignupSession', () => ({
  createEmbeddedSignupGate: () => ({
    cancel: vi.fn(),
    expire: vi.fn(),
    acceptCode: vi.fn(),
    acceptSession: vi.fn(),
    outcome: new Promise(() => {}),
  }),
  parseEmbeddedSignupMessage: () => null,
}))

import { useEmbeddedSignup, __resetSdkReadyForTests } from '@/lib/facebook/useEmbeddedSignup'

const APP_ID = '123'
const CONFIG_ID = 'cfg_1'
const VERSION = 'v21.0'

/** A stand-in for the real SDK. `init` is what readiness must actually wait on. */
function fakeFB() {
  return { init: vi.fn(), login: vi.fn() }
}

const mount = () => renderHook(() => useEmbeddedSignup(APP_ID, CONFIG_ID, VERSION))

beforeEach(() => {
  __resetSdkReadyForTests()
  vi.useFakeTimers()
  delete (window as { FB?: unknown }).FB
  delete (window as { fbAsyncInit?: unknown }).fbAsyncInit
  document.getElementById('facebook-jssdk')?.remove()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('SDK already initialised', () => {
  it('calls FB.login immediately, without waiting', async () => {
    const FB = fakeFB()
    ;(window as unknown as { FB: typeof FB }).FB = FB

    const { result } = mount()
    expect(FB.init).toHaveBeenCalledTimes(1) // effect initialised the present SDK

    act(() => {
      void result.current.launch()
    })

    // No timer advance: readiness was already established, so login is reached
    // in the same task as the click. This is what keeps the popup unblocked.
    expect(FB.login).toHaveBeenCalledTimes(1)
  })

  it('preserves the FB.login payload exactly', () => {
    const FB = fakeFB()
    ;(window as unknown as { FB: typeof FB }).FB = FB
    const { result } = mount()

    act(() => {
      void result.current.launch()
    })

    const [callback, opts] = FB.login.mock.calls[0]
    expect(typeof callback).toBe('function')
    expect(opts).toEqual({
      config_id: CONFIG_ID,
      response_type: 'code',
      override_default_response_type: true,
      extras: { version: 'v4', featureType: 'whatsapp_business_app_onboarding' },
    })
  })
})

describe('SDK present but init not yet run', () => {
  it('does not call FB.login until init completes', async () => {
    // The exact production race: window.FB exists, fbAsyncInit has not fired.
    const FB = fakeFB()
    const { result } = mount()

    // Hook injected the script and registered fbAsyncInit. sdk.js now "executes":
    // it defines window.FB but the loader has not called fbAsyncInit yet.
    ;(window as unknown as { FB: typeof FB }).FB = FB

    let settled = false
    act(() => {
      void result.current.launch().then(() => {
        settled = true
      })
    })

    expect(FB.login).not.toHaveBeenCalled() // waits — does not fire blind
    expect(settled).toBe(false)

    await act(async () => {
      window.fbAsyncInit?.() // the loader finally runs init
    })

    expect(FB.init).toHaveBeenCalledTimes(1)
    expect(FB.login).toHaveBeenCalledTimes(1) // released by readiness, not by luck
  })

  it('registers fbAsyncInit before injecting the script tag', () => {
    mount()
    expect(typeof window.fbAsyncInit).toBe('function')
    expect(document.getElementById('facebook-jssdk')).not.toBeNull()
  })

  it('registers fbAsyncInit even when window.FB is already present', () => {
    // The third hole: the original code assigned fbAsyncInit only on the
    // not-yet-loaded branch, so whenever window.FB happened to exist at mount
    // nothing was left registered for the loader to call. An existing script tag
    // then made it unrecoverable — getElementById saw the tag and skipped
    // re-injection, so init never ran for anyone who needed it.
    const tag = document.createElement('script')
    tag.id = 'facebook-jssdk'
    document.body.appendChild(tag)
    const FB = fakeFB()
    ;(window as unknown as { FB: typeof FB }).FB = FB

    mount()

    expect(typeof window.fbAsyncInit).toBe('function')
    expect(document.querySelectorAll('#facebook-jssdk')).toHaveLength(1) // no duplicate
  })
})

describe('SDK never becomes ready', () => {
  it('resolves the existing sdk error instead of loading forever', async () => {
    const { result } = mount()

    let outcome: unknown
    act(() => {
      void result.current.launch().then((r) => {
        outcome = r
      })
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
    })

    expect(outcome).toEqual({ ok: false, error: 'sdk' })
  })

  it('settles well before the 5-minute launch timeout', async () => {
    const { result } = mount()

    let outcome: unknown
    act(() => {
      void result.current.launch().then((r) => {
        outcome = r
      })
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(14_999)
    })
    expect(outcome).toBeUndefined() // still inside the readiness budget

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(outcome).toEqual({ ok: false, error: 'sdk' })
  })

  it('does not call FB.login after the readiness timeout has already settled', async () => {
    const FB = fakeFB()
    const { result } = mount()

    let count = 0
    act(() => {
      void result.current.launch().then(() => {
        count += 1
      })
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
    })

    // The SDK shows up late. It must not retroactively open a popup for a launch
    // the user was already told had failed.
    ;(window as unknown as { FB: typeof FB }).FB = FB
    await act(async () => {
      window.fbAsyncInit?.()
    })

    expect(FB.login).not.toHaveBeenCalled()
    expect(count).toBe(1) // resolved exactly once
  })
})

describe('FB.login callback still drives the result', () => {
  it('maps a cancelled login to the existing cancelled error', async () => {
    const FB = fakeFB()
    ;(window as unknown as { FB: typeof FB }).FB = FB
    const { result } = mount()

    let outcome: unknown
    act(() => {
      void result.current.launch().then((r) => {
        outcome = r
      })
    })

    const callback = FB.login.mock.calls[0][0] as (r: unknown) => void
    await act(async () => {
      callback({ authResponse: null }) // user closed the popup
    })

    expect(outcome).toEqual({ ok: false, error: 'cancelled' })
  })

  it('surfaces a synchronous FB.login throw as the sdk error', async () => {
    const FB = fakeFB()
    FB.login.mockImplementation(() => {
      throw new Error('boom')
    })
    ;(window as unknown as { FB: typeof FB }).FB = FB
    const { result } = mount()

    let outcome: unknown
    await act(async () => {
      outcome = await result.current.launch()
    })

    expect(outcome).toEqual({ ok: false, error: 'sdk' })
  })
})

describe('initialisation is not duplicated', () => {
  it('injects the script once and inits once across re-renders', () => {
    const FB = fakeFB()
    ;(window as unknown as { FB: typeof FB }).FB = FB

    const { rerender } = mount()
    rerender()
    rerender()

    expect(FB.init).toHaveBeenCalledTimes(1)
    expect(document.querySelectorAll('#facebook-jssdk')).toHaveLength(0) // FB already present
  })
})
