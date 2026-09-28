// @vitest-environment jsdom
/**
 * Two Facebook apps, one global `window.FB`.
 *
 * Reproduced in production 2026-08-30: click "לחבר מחדש" → "מתחבר..." → after
 * EXACTLY 15s (SDK_READY_TIMEOUT_MS) back to "לחבר מחדש", no popup, and
 * `/api/whatsapp/embedded-signup` never reached.
 *
 * The shipped `sdk.js` is a loader stub, and reading it explains everything:
 *
 *   - `if (window.FB || !window.JSON) return` — a second stub (the he_IL one the
 *     auth components load for AUTH_FACEBOOK_APP_ID) executes and does NOTHING.
 *     It loads no bundle and calls no `fbAsyncInit`. A readiness latch that waits
 *     on `fbAsyncInit` therefore waits forever.
 *   - It installs `window.FB` synchronously as a buffering shim whose `login`
 *     only pushes onto `__buffer.calls`. `window.FB` truthy proves nothing.
 *
 * These tests pin the ownership model that replaces it: readiness is OBSERVED on
 * `window.FB` (no `__buffer`), never awaited via a callback we may never receive.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'

vi.mock('@/lib/facebook/embeddedSignupSession', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/facebook/embeddedSignupSession')>()),
  // Like the real gate, `cancel` settles the outcome; nothing else ever does here.
  createEmbeddedSignupGate: () => {
    let settle: (o: { kind: 'cancelled' }) => void = () => {}
    const outcome = new Promise((resolve) => {
      settle = resolve
    })
    return {
      cancel: vi.fn(() => settle({ kind: 'cancelled' })),
      expire: vi.fn(),
      acceptCode: vi.fn(),
      acceptSession: vi.fn(),
      acceptCancel: vi.fn(),
      outcome,
    }
  },
  parseEmbeddedSignupMessage: () => null,
}))

import { useEmbeddedSignup } from '@/lib/facebook/useEmbeddedSignup'
import {
  facebookSdkIsReady,
  facebookSdkIsBuffering,
  __resetFacebookSdkForTests,
} from '@/lib/facebook/facebookSdk'

const APP_ID = '111'
const AUTH_APP_ID = '999'
const CONFIG_ID = 'cfg_1'
const VERSION = 'v21.0'

const realSdk = () => ({ init: vi.fn(), login: vi.fn() })
const shim = () => {
  const calls: unknown[] = []
  return {
    __buffer: { calls, opts: null },
    init: vi.fn(),
    login: vi.fn((...a: unknown[]) => {
      calls.push(a)
    }),
  }
}
const setFB = (fb: unknown) => {
  ;(window as unknown as { FB: unknown }).FB = fb
}
const mount = () => renderHook(() => useEmbeddedSignup(APP_ID, CONFIG_ID, VERSION))

beforeEach(() => {
  __resetFacebookSdkForTests()
  vi.useFakeTimers()
  delete (window as { FB?: unknown }).FB
  delete (window as { fbAsyncInit?: unknown }).fbAsyncInit
  document.getElementById('facebook-jssdk')?.remove()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('readiness discriminates the shim from the real SDK', () => {
  it('treats the buffering shim as NOT ready', () => {
    setFB(shim())
    expect(facebookSdkIsReady()).toBe(false)
    expect(facebookSdkIsBuffering()).toBe(true)
  })

  it('treats the real SDK as ready', () => {
    setFB(realSdk())
    expect(facebookSdkIsReady()).toBe(true)
    expect(facebookSdkIsBuffering()).toBe(false)
  })
})

describe('another Facebook SDK consumer got there first', () => {
  it('does not inject a second stub when one already owns window.FB', () => {
    // The auth SDK's he_IL stub already ran. Ours would `return` on
    // `if (window.FB)` anyway; injecting it would only add a dead tag.
    setFB(shim())
    mount()
    expect(document.querySelectorAll('#facebook-jssdk')).toHaveLength(0)
  })

  it('still reaches readiness when the OTHER consumer loads the bundle', async () => {
    // Our stub no-ops, so no fbAsyncInit of ours will ever fire. The he_IL
    // bundle is what lands. Observation still sees it; a callback never would.
    setFB(shim())
    const { result } = mount()

    let outcome: unknown
    act(() => {
      void result.current.launch().then((r) => {
        outcome = r
      })
    })

    const FB = realSdk()
    await act(async () => {
      setFB(FB)
      await vi.advanceTimersByTimeAsync(100)
    })

    expect(FB.login).toHaveBeenCalledTimes(1)
    expect(outcome).toBeUndefined() // waiting on the popup, not failed
  })

  it('never calls login on a shim even if the bundle never arrives', async () => {
    const s = shim()
    setFB(s)
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

    expect(s.login).not.toHaveBeenCalled()
    expect(s.__buffer.calls).toHaveLength(0) // nothing silently queued
    expect(outcome).toEqual({ ok: false, error: 'sdk' })
  })
})

describe('app ownership on the shared SDK', () => {
  it('re-asserts META_APP_ID immediately before login', () => {
    // The auth components call FB.init with AUTH_FACEBOOK_APP_ID from their own
    // effects. Whoever ran last would otherwise own the binding.
    const FB = realSdk()
    setFB(FB)
    FB.init({ appId: AUTH_APP_ID, cookie: true, xfbml: false, version: 'v19.0' })

    const { result } = mount()
    act(() => {
      void result.current.launch()
    })

    const lastInit = FB.init.mock.calls.at(-1)?.[0] as { appId: string; version: string }
    expect(lastInit.appId).toBe(APP_ID)
    expect(lastInit.version).toBe(VERSION)
    // and it happened BEFORE login, in the same task
    expect(FB.init.mock.invocationCallOrder.at(-1)!).toBeLessThan(
      FB.login.mock.invocationCallOrder[0],
    )
  })

  it('does not bind our app at mount, only at launch', () => {
    // Mount-time binding is a race with the auth components' effects.
    const FB = realSdk()
    setFB(FB)
    mount()
    expect(FB.init).not.toHaveBeenCalled()
  })
})

describe('user gesture is preserved', () => {
  it('calls FB.login synchronously when the real SDK is already present', () => {
    const FB = realSdk()
    setFB(FB)
    const { result } = mount()

    act(() => {
      void result.current.launch()
    })

    // No timer advance, no awaited microtask boundary: still inside the click.
    expect(FB.login).toHaveBeenCalledTimes(1)
  })
})

describe('no unbounded loading', () => {
  it('a dead script tag does not make the failure permanent', async () => {
    // The old code skipped injection whenever #facebook-jssdk existed, so one
    // blocked load meant every retry timed out forever.
    const dead = document.createElement('script')
    dead.id = 'facebook-jssdk'
    document.body.appendChild(dead)

    mount()
    // Nothing owns window.FB, so the corpse must be REPLACED, not respected.
    const tags = document.querySelectorAll('#facebook-jssdk')
    expect(tags).toHaveLength(1)
    expect(tags[0]).not.toBe(dead)
    expect(tags[0].getAttribute('src')).toContain('connect.facebook.net')

    const FB = realSdk()
    await act(async () => {
      setFB(FB)
      await vi.advanceTimersByTimeAsync(100)
    })
    expect(facebookSdkIsReady()).toBe(true)
  })

  it('resolves the sdk error and stops — never hangs', async () => {
    const { result } = mount()
    let outcome: unknown
    act(() => {
      void result.current.launch().then((r) => {
        outcome = r
      })
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(14_900)
    })
    expect(outcome).toBeUndefined()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })
    expect(outcome).toEqual({ ok: false, error: 'sdk' })
  })
})
