// @vitest-environment jsdom
/**
 * Client-side reliability of the WhatsApp connect surface.
 *
 * Two defects observed live on 2026-08-30, while a Coexistence transition was
 * being attempted on a real canary number:
 *
 *   1. ONE shared `useAction` drove both buttons, so starting a connect made the
 *      red DISCONNECT button render "מתנתק..." and go disabled — the destructive
 *      control appearing to run when nothing had been clicked.
 *   2. Every `resolve` in `launch()` lives inside FB.login's callback. When that
 *      callback never fired the promise never settled, `useAction`'s `finally`
 *      never ran, and the button spun until the page was reloaded.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, act } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

const H = vi.hoisted(() => ({ launch: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  useSearchParams: () => ({ get: () => null }),
}))
vi.mock('@/lib/facebook/useEmbeddedSignup', () => ({ useEmbeddedSignup: () => ({ launch: H.launch }) }))
// NOTE: `useAction` is deliberately NOT mocked here. These tests are about the
// real loading lifecycle, which a stubbed hook would hide.
vi.mock('@/lib/entitlement/EntitlementContext', () => ({ useAccessDenied: () => false }))

import WhatsappConnect from '@/components/settings/WhatsappConnect'

const PHONE_ID = '972007939322425'
const base = { pendingPhones: null, appId: 'a', configId: 'c', graphVersion: 'v19.0' as const }
// The launch control on an existing connection is RECONNECT. These two cases
// are about `useAction` independence, not about coexistence — they only ever
// needed a control that starts a launch. The history-labelled button they used
// to click no longer exists: it was Embedded Signup wearing history copy.
const LAUNCH = /לחבר מחדש/
const DISCONNECT = /נתק וואטסאפ/
const DISCONNECTING = /מנתק\.\.\./
const CONNECTING = /מתחבר\.\.\./

beforeEach(() => {
  H.launch = vi.fn()
  global.fetch = vi.fn(async () => new Response('{}')) as never
})
afterEach(() => cleanup())

describe('0 · a failed launch is visible in State C', () => {
  // Production 2026-08-30: State C read ONLY `noticeForHealth(status)`, so a
  // failed Embedded Signup called setError into state that nothing rendered.
  // The button reverted to the health action and the operator saw no reason —
  // indistinguishable from never having clicked.
  const RECONNECT = /לחבר מחדש/
  const SDK_TITLE = /חלון ההתחברות לא נפתח/
  const EXPIRED_TITLE = /החיבור לוואטסאפ פג/

  it('shows the SDK notice instead of silently reverting to the health notice', async () => {
    H.launch = vi.fn(async () => ({ ok: false, error: 'sdk' }))
    render(<WhatsappConnect {...base} connection={{ phoneNumberId: PHONE_ID }} status='token' />)

    // Before the click: the health notice owns the surface.
    expect(screen.getByText(EXPIRED_TITLE)).toBeInTheDocument()

    await act(async () => {
      screen.getByRole('button', { name: RECONNECT }).click()
    })

    expect(screen.getByText(SDK_TITLE)).toBeInTheDocument()
    expect(screen.queryByText(EXPIRED_TITLE)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: CONNECTING })).not.toBeInTheDocument()
  })

  it('keeps the health notice when the user simply cancelled Meta\'s popup', async () => {
    // Cancelling is not a failure to explain; whatsappNotice returns null for it.
    H.launch = vi.fn(async () => ({ ok: false, error: 'cancelled' }))
    render(<WhatsappConnect {...base} connection={{ phoneNumberId: PHONE_ID }} status='token' />)

    await act(async () => {
      screen.getByRole('button', { name: RECONNECT }).click()
    })

    expect(screen.getByText(EXPIRED_TITLE)).toBeInTheDocument()
    expect(screen.queryByText(SDK_TITLE)).not.toBeInTheDocument()
  })
})

describe('1 · connect and disconnect own independent action state', () => {
  it('an in-flight connect NEVER shows "מנתק..." or disables the disconnect button', async () => {
    // A launch that never settles — exactly the stuck production case.
    H.launch = vi.fn(() => new Promise(() => {}))
    render(
      <WhatsappConnect {...base} connection={{ phoneNumberId: PHONE_ID }} status='token' />,
    )

    await act(async () => {
      screen.getByRole('button', { name: LAUNCH }).click()
    })

    // The connect button reflects its own work…
    expect(screen.getByRole('button', { name: CONNECTING })).toBeInTheDocument()
    // …and the destructive button is untouched: original label, still enabled.
    const disconnect = screen.getByRole('button', { name: DISCONNECT })
    expect(disconnect).toBeInTheDocument()
    expect(disconnect).not.toBeDisabled()
    expect(screen.queryByRole('button', { name: DISCONNECTING })).not.toBeInTheDocument()
  })

  it('an in-flight disconnect does not disable or relabel the connect action', async () => {
    // A disconnect request that stays in flight, so its loading state is observable.
    global.fetch = vi.fn(() => new Promise<Response>(() => {})) as never

    render(
      <WhatsappConnect {...base} connection={{ phoneNumberId: PHONE_ID }} status='token' />,
    )
    await act(async () => { screen.getByRole('button', { name: DISCONNECT }).click() })
    await act(async () => { screen.getByRole('button', { name: /אישור/ }).click() })

    expect(global.fetch).toHaveBeenCalledWith('/api/auth/whatsapp/disconnect', { method: 'POST' })
    // The disconnect reflects its own work…
    expect(screen.getByRole('button', { name: DISCONNECTING })).toBeInTheDocument()
    // …and the connect action is untouched: original label, still enabled.
    const connect = screen.getByRole('button', { name: LAUNCH })
    expect(connect).not.toBeDisabled()
    expect(screen.queryByRole('button', { name: CONNECTING })).not.toBeInTheDocument()
  })

  it('disconnect still requires explicit confirmation (protection preserved)', async () => {
    render(
      <WhatsappConnect {...base} connection={{ phoneNumberId: PHONE_ID }} status='operational' />,
    )
    await act(async () => { screen.getByRole('button', { name: DISCONNECT }).click() })
    expect(global.fetch).not.toHaveBeenCalled()
    expect(screen.getByText('לנתק את חיבור הוואטסאפ?')).toBeInTheDocument()
  })

  it('the component uses TWO independent action states', () => {
    const src = require('node:fs').readFileSync('components/settings/WhatsappConnect.tsx', 'utf8')
    expect(src.match(/useAction\(\)/g)?.length).toBe(2)
    expect(src).toContain("loading: disconnecting")
    expect(src).toContain('runDisconnect')
    // The destructive button reads ONLY its own state.
    // Labels from the catalog since Phase E4 (settings.integrations.whatsapp.*).
    expect(src).toContain("lbl={disconnecting ? t('settings.integrations.whatsapp.disconnecting') : t('settings.integrations.whatsapp.disconnect')}")
    expect(src).toContain('disabled={disconnecting}')
  })
})

describe('2 · the Embedded Signup launch is bounded', () => {
  it('resolves with a recoverable error if FB.login never calls back', async () => {
    vi.useFakeTimers()
    try {
      vi.resetModules()
      vi.doMock('@/lib/facebook/embeddedSignupSession', () => ({
        createEmbeddedSignupGate: () => ({ cancel: vi.fn(), acceptCode: vi.fn(), expire: vi.fn(), outcome: new Promise(() => {}) }),
        parseEmbeddedSignupMessage: () => null,
      }))
      const src = require('node:fs').readFileSync('lib/facebook/useEmbeddedSignup.ts', 'utf8')
      // The valve exists, is generous enough not to cut a real signup short,
      // and resolves as a mapped, retryable error rather than hanging.
      expect(src).toContain('const LAUNCH_TIMEOUT_MS = 300_000')
      // `reason: 'timeout'` is analytics-only; the UI still maps the 'sdk' notice.
      expect(src).toContain(
        "timer = setTimeout(() => settle({ ok: false, error: 'sdk', reason: 'timeout' }), LAUNCH_TIMEOUT_MS)",
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('every resolve path clears the timer via settle(), and settle() is not recursive', () => {
    const src = require('node:fs').readFileSync('lib/facebook/useEmbeddedSignup.ts', 'utf8')
    // The flow body is `launchFlow`; `launch` is only its reporting wrapper.
    const launch = src.slice(
      src.indexOf('const launchFlow = useCallback'),
      src.indexOf('}, [appId, configId, graphVersion])'),
    )
    // No bare resolve( survives inside launch except settle's own single call.
    expect(launch.match(/(?<![A-Za-z_.])resolve\(/g)?.length).toBe(1)
    expect(launch).toContain('if (timer !== undefined) clearTimeout(timer)')
    // settle must call resolve, never itself.
    expect(launch).not.toMatch(/const settle[\s\S]{0,120}settle\(result\)/)
  })
})
