// @vitest-environment jsdom
/**
 * End to end through the real hook and gate, with a fake Facebook SDK: Meta's
 * CANCEL ids reach analytics whether the CANCEL lands before the login callback,
 * just after it, or long after the attempt timed out — and the launch payload is
 * exactly what it was.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'

const h = vi.hoisted(() => ({ events: [] as { event: string; props?: Record<string, unknown> }[] }))
vi.mock('@/actions/analytics/recordLeadActionEvent', () => ({
  recordLeadActionEvent: vi.fn(async (event: string, props?: Record<string, unknown>) => {
    h.events.push({ event, props })
  }),
}))

import { useEmbeddedSignup } from '@/lib/facebook/useEmbeddedSignup'
import { __resetFacebookSdkForTests } from '@/lib/facebook/facebookSdk'

type LoginCb = (r: { authResponse?: { code?: string } | null }) => void
const fakeFB = () => ({ init: vi.fn(), login: vi.fn() })
const failures = () => h.events.filter((e) => e.event === 'whatsapp_connect_failed')
const details = () => h.events.filter((e) => e.event === 'whatsapp_connect_cancel_detail')

function metaCancel(data: Record<string, unknown>, origin = 'https://www.facebook.com') {
  window.dispatchEvent(new MessageEvent('message', { origin, data: JSON.stringify({ type: 'WA_EMBEDDED_SIGNUP', event: 'CANCEL', data }) }))
}

let FB: ReturnType<typeof fakeFB>
beforeEach(() => {
  h.events = []
  __resetFacebookSdkForTests()
  vi.useFakeTimers()
  sessionStorage.clear()
  FB = fakeFB()
  ;(window as unknown as { FB: typeof FB }).FB = FB
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function launch() {
  const { result } = renderHook(() => useEmbeddedSignup('123', 'cfg_1', 'v21.0'))
  let done!: Promise<unknown>
  act(() => {
    done = result.current.launch()
  })
  return { done, callback: FB.login.mock.calls[0][0] as LoginCb, opts: FB.login.mock.calls[0][1] }
}

describe('Meta CANCEL ids reach analytics', () => {
  it('the launch payload is unchanged', () => {
    const { opts } = launch()
    expect(opts).toEqual({
      config_id: 'cfg_1', response_type: 'code', override_default_response_type: true,
      extras: { version: 'v4', featureType: 'whatsapp_business_app_onboarding' },
    })
  })

  it('CANCEL before the callback: the failure itself carries step, error id and session id', async () => {
    const { done, callback } = launch()
    metaCancel({ current_step: 'PHONE_NUMBER_SETUP', session_id: 'sessEarly', error_id: '11' })
    callback({ authResponse: null })
    await act(async () => { await done })
    expect(failures()[0].props).toMatchObject({ reason: 'cancelled', step: 'PHONE_NUMBER_SETUP', metaErrorId: '11', metaSessionId: 'sessEarly' })
    expect(details()).toHaveLength(0)
  })

  it('CANCEL after the one-second grace: reported as a follow-up with the same attempt id', async () => {
    const { done, callback } = launch()
    callback({ authResponse: null })
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); await done })
    expect(failures()[0].props).toMatchObject({ reason: 'cancelled' })
    expect(failures()[0].props!.metaSessionId).toBeUndefined()
    metaCancel({ error_message: 'This number can’t be shared with this app.', error_id: '524126', session_id: 'sessLate' })
    expect(details()).toHaveLength(1)
    expect(details()[0].props).toEqual({ attemptId: failures()[0].props!.attemptId, metaErrorId: '524126', metaSessionId: 'sessLate' })
  })

  it('five minutes, then a CANCEL with no callback: pending, one follow-up, no failure', async () => {
    const { done } = launch()
    await act(async () => { await vi.advanceTimersByTimeAsync(300_000); await done })
    expect(failures()).toHaveLength(0)
    const pending = h.events.find((e) => e.event === 'whatsapp_connect_pending')
    metaCancel({ current_step: 'PHONE_NUMBER_SETUP', session_id: 'sessT' })
    expect(details()).toHaveLength(1)
    expect(details()[0].props).toEqual({ attemptId: pending!.props!.attemptId, step: 'PHONE_NUMBER_SETUP', metaSessionId: 'sessT' })
    expect(JSON.stringify(h.events)).not.toContain('shared')
  })

  it('a CANCEL from a non-Facebook origin is ignored', async () => {
    const { done } = launch()
    await act(async () => { await vi.advanceTimersByTimeAsync(300_000); await done })
    metaCancel({ session_id: 'sessX' }, 'https://evilfacebook.com')
    expect(details()).toHaveLength(0)
  })
})
