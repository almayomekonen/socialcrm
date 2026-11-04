// @vitest-environment jsdom
/**
 * Through the real hook and gate with a fake Facebook SDK: Meta's ERROR events are
 * kept, a five-minute silence is pending and not a failure, a late FINISH still
 * connects, and every documented finish shape reaches the server.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'

const h = vi.hoisted(() => ({ events: [] as { event: string; props?: Record<string, unknown> }[] }))
vi.mock('@/actions/analytics/recordLeadActionEvent', () => ({
  recordLeadActionEvent: vi.fn(async (event: string, props?: Record<string, unknown>) => {
    h.events.push({ event, props })
  }),
}))

import { useEmbeddedSignup, type EmbeddedSignupResult } from '@/lib/facebook/useEmbeddedSignup'
import { __resetFacebookSdkForTests } from '@/lib/facebook/facebookSdk'
import { createEmbeddedSignupGate, pendingAfter, parseEmbeddedSignupCancel, parseEmbeddedSignupMessage, parseEmbeddedSignupShape } from '@/lib/facebook/embeddedSignupSession'

type LoginCb = (r: { authResponse?: { code?: string } | null }) => void
const FB_ORIGIN = 'https://www.facebook.com'
const of = (event: string) => h.events.filter((e) => e.event === event)
const failures = () => of('whatsapp_connect_failed')

function meta(event: string, data: Record<string, unknown>, origin = FB_ORIGIN) {
  window.dispatchEvent(new MessageEvent('message', { origin, data: JSON.stringify({ type: 'WA_EMBEDDED_SIGNUP', event, data }) }))
}

const ERROR_DATA = {
  error_message: 'Your phone number is already linked to automatic events.',
  error_code: '3441061',
  session_id: '01a1a605-80f9-7ba2-a2cc-f13d153deafd',
  timestamp: '1746041036000',
}

let FB: { init: ReturnType<typeof vi.fn>; login: ReturnType<typeof vi.fn> }
beforeEach(() => {
  h.events = []
  __resetFacebookSdkForTests()
  vi.useFakeTimers()
  sessionStorage.clear()
  FB = { init: vi.fn(), login: vi.fn() }
  ;(window as unknown as { FB: typeof FB }).FB = FB
  global.fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true, messagingReady: true }), { status: 200 })) as unknown as typeof fetch
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function launch(call = 0) {
  const { result } = renderHook(() => useEmbeddedSignup('123', 'cfg_1', 'v21.0'))
  let done!: Promise<EmbeddedSignupResult>
  act(() => {
    done = result.current.launch()
  })
  return { done, hook: result, callback: FB.login.mock.calls[call][0] as LoginCb }
}

const signupPost = () => vi.mocked(global.fetch).mock.calls.find(([url]) => String(url) === '/api/whatsapp/embedded-signup')
const postedBody = () => JSON.parse(String((signupPost()![1] as RequestInit).body))

describe('parsing Meta messages', () => {
  it('reads an ERROR event in the documented shape', () => {
    expect(parseEmbeddedSignupCancel(FB_ORIGIN, { type: 'WA_EMBEDDED_SIGNUP', event: 'ERROR', data: ERROR_DATA })).toEqual({
      errorReported: true,
      errorMessage: ERROR_DATA.error_message,
      errorId: '3441061',
      sessionId: ERROR_DATA.session_id,
      timestamp: '1746041036000',
    })
  })

  it('an ERROR with no usable text still counts as reported, and keeps a trace id if Meta sends one', () => {
    expect(parseEmbeddedSignupCancel(FB_ORIGIN, { type: 'WA_EMBEDDED_SIGNUP', event: 'ERROR', data: { error_code: 12, fbtrace_id: 'AbC_1' } })).toEqual({
      errorReported: true,
      errorId: '12',
      traceId: 'AbC_1',
    })
  })

  it('ignores an ERROR from any other origin', () => {
    expect(parseEmbeddedSignupCancel('https://evilfacebook.com', { type: 'WA_EMBEDDED_SIGNUP', event: 'ERROR', data: ERROR_DATA })).toBeNull()
  })

  it.each([
    ['FINISH', 'cloud_api'],
    ['FINISH_ONLY_WABA', 'cloud_api'],
    ['FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING', 'coexistence'],
  ])('%s with one account gives that account', (event, onboardingType) => {
    expect(parseEmbeddedSignupMessage(FB_ORIGIN, { type: 'WA_EMBEDDED_SIGNUP', event, data: { waba_id: 'W1' } })).toEqual({ waba_id: 'W1', phone_number_id: undefined, onboardingType })
  })

  it.each([
    ['messaging_account_ids', { messaging_account_ids: ['W1', 'W2'] }],
    ['waba_ids', { waba_ids: ['W1', 'W2'] }],
    ['waba_id with waba_ids', { waba_id: 'W1', waba_ids: ['W1', 'W2'] }],
  ])('%s: several accounts stay candidates, never a guess', (_label, data) => {
    const session = parseEmbeddedSignupMessage(FB_ORIGIN, { type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH', data })
    expect(session?.waba_id).toBeUndefined()
    expect(session?.wabaCandidates).toEqual(['W1', 'W2'])
  })

  it('the outline of a message has field names and no values', () => {
    const shape = parseEmbeddedSignupShape(FB_ORIGIN, {
      type: 'WA_EMBEDDED_SIGNUP',
      event: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',
      data: { phone_number_id: 'P-SECRET', messaging_account_ids: ['W-SECRET'], is_on_biz_app: true },
    })
    expect(shape).toEqual({
      metaEvent: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',
      metaPayloadKeys: ['phone_number_id', 'messaging_account_ids', 'is_on_biz_app'],
      isOnBizApp: true,
      accountCount: 1,
    })
    expect(JSON.stringify(shape)).not.toContain('SECRET')
  })

  it('a new Meta event name is recorded as OTHER', () => {
    expect(parseEmbeddedSignupShape(FB_ORIGIN, { type: 'WA_EMBEDDED_SIGNUP', event: 'NEW_THING', data: {} })?.metaEvent).toBe('OTHER')
  })
})

describe('the gate', () => {
  it('a CANCEL after an ERROR adds to it and never erases it', async () => {
    const gate = createEmbeddedSignupGate()
    gate.acceptCancel({ errorReported: true, errorMessage: 'x', errorId: '1', sessionId: 's' })
    gate.acceptCancel({ errorReported: false, step: 'PHONE_NUMBER_SETUP' })
    gate.cancel()
    expect(await gate.outcome).toEqual({
      kind: 'cancelled',
      detail: { errorReported: true, errorMessage: 'x', errorId: '1', sessionId: 's', step: 'PHONE_NUMBER_SETUP' },
    })
  })
})

describe('Meta ERROR through the hook', () => {
  it('is reported as it arrives, tied to the attempt, before any outcome exists', () => {
    launch()
    meta('ERROR', ERROR_DATA)
    const started = of('whatsapp_connect_started')[0]
    expect(of('whatsapp_connect_meta_event')).toHaveLength(1)
    expect(of('whatsapp_connect_meta_event')[0].props).toMatchObject({
      attemptId: started.props!.attemptId,
      metaEvent: 'ERROR',
      metaErrorId: '3441061',
      metaSessionId: ERROR_DATA.session_id,
      metaTimestamp: '1746041036000',
      metaErrorMessage: ERROR_DATA.error_message,
    })
    expect(failures()).toHaveLength(0)
  })

  it('the same message twice is stored once', () => {
    launch()
    meta('ERROR', ERROR_DATA)
    meta('ERROR', ERROR_DATA)
    expect(of('whatsapp_connect_meta_event')).toHaveLength(1)
  })

  it('then the window closes: a meta_error failure with Meta’s ids, and the customer sees Meta’s words', async () => {
    const { done, callback } = launch()
    meta('ERROR', ERROR_DATA)
    callback({ authResponse: null })
    let result!: EmbeddedSignupResult
    await act(async () => { result = await done })
    expect(result.cancel?.errorMessage).toBe(ERROR_DATA.error_message)
    expect(failures()[0].props).toMatchObject({ reason: 'meta_error', metaErrorId: '3441061', metaSessionId: ERROR_DATA.session_id })
    // The failure event carries ids only; the text lives in the meta event.
    expect(failures()[0].props).not.toHaveProperty('metaErrorMessage')
  })

  it('an ERROR the customer recovers from does not stop a later FINISH', async () => {
    const { done, callback } = launch()
    meta('ERROR', ERROR_DATA)
    meta('FINISH', { waba_id: 'W1', phone_number_id: 'P1' })
    callback({ authResponse: { code: 'oauth-code' } })
    let result!: EmbeddedSignupResult
    await act(async () => { result = await done })
    expect(result.ok).toBe(true)
    expect(failures()).toHaveLength(0)
  })

  it('no message reaches analytics with an account or phone id', () => {
    launch()
    meta('FINISH', { waba_id: 'W-PRIVATE', phone_number_id: 'P-PRIVATE' })
    expect(JSON.stringify(h.events)).not.toContain('PRIVATE')
  })

})

describe('five minutes with no outcome', () => {
  it('pendingAfter does nothing if the real outcome arrives first', async () => {
    const onPending = vi.fn()
    await pendingAfter(Promise.resolve({ ok: true }), 1000, onPending)
    await vi.advanceTimersByTimeAsync(2000)
    expect(onPending).not.toHaveBeenCalled()
  })

  const FIVE_MINUTES = 300_000
  async function toPending() {
    const started = launch()
    let result!: EmbeddedSignupResult
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FIVE_MINUTES)
      result = await started.done
    })
    return { ...started, result }
  }

  it('is pending: no failure recorded, and the attempt stays open', async () => {
    const { result } = await toPending()
    expect(result).toMatchObject({ ok: false, error: 'pending' })
    expect(result.late).toBeInstanceOf(Promise)
    expect(failures()).toHaveLength(0)
    expect(of('whatsapp_connect_pending')[0].props).toMatchObject({ attemptId: of('whatsapp_connect_started')[0].props!.attemptId, elapsedMs: FIVE_MINUTES })
    expect(sessionStorage.getItem('socialcrm:wa-connect-pending')).not.toBeNull()
  })

  it('a late FINISH still connects, resolves `late` as success, and records no failure', async () => {
    const { result, callback } = await toPending()
    meta('FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING', { waba_id: 'W1', phone_number_id: 'P1' })
    callback({ authResponse: { code: 'late-code' } })
    let late!: EmbeddedSignupResult
    await act(async () => { late = await result.late! })
    expect(late).toMatchObject({ ok: true, messagingReady: true })
    expect(postedBody()).toMatchObject({ code: 'late-code', wabaId: 'W1', phoneNumberId: 'P1', onboardingType: 'coexistence', attemptId: of('whatsapp_connect_started')[0].props!.attemptId })
    expect(failures()).toHaveLength(0)
    expect(sessionStorage.getItem('socialcrm:wa-connect-pending')).toBeNull()
  })

  it('a late FINISH that arrives after the code connects too', async () => {
    const { result, callback } = await toPending()
    callback({ authResponse: { code: 'late-code' } })
    meta('FINISH', { waba_id: 'W1', phone_number_id: 'P1' })
    let late!: EmbeddedSignupResult
    await act(async () => { late = await result.late! })
    expect(late.ok).toBe(true)
  })

  it('a late close without a code is the real outcome, with the same attempt id', async () => {
    const { result, callback } = await toPending()
    callback({ authResponse: null })
    let late!: EmbeddedSignupResult
    await act(async () => {
      const settled = result.late!
      await vi.advanceTimersByTimeAsync(2000)
      late = await settled
    })
    expect(late.error).toBe('cancelled')
    expect(failures()).toHaveLength(1)
    expect(failures()[0].props).toMatchObject({ reason: 'cancelled', attemptId: of('whatsapp_connect_started')[0].props!.attemptId })
  })

  it('a CANCEL after a late success is noise, not a follow-up report', async () => {
    const { result, callback } = await toPending()
    meta('FINISH', { waba_id: 'W1', phone_number_id: 'P1' })
    callback({ authResponse: { code: 'late-code' } })
    await act(async () => { await result.late! })
    meta('CANCEL', { current_step: 'PHONE_NUMBER_SETUP' })
    expect(of('whatsapp_connect_cancel_detail')).toHaveLength(0)
  })

  it('a retry replaces it: the old attempt reports no failure, and its code is not used', async () => {
    const first = await toPending()
    const { result } = renderHook(() => useEmbeddedSignup('123', 'cfg_1', 'v21.0'))
    act(() => { void result.current.launch() })
    first.callback({ authResponse: { code: 'stale-code' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    expect(failures()).toHaveLength(0)
    expect(signupPost()).toBeUndefined()
    expect(of('whatsapp_connect_started')[0].props!.attemptId).not.toBe(of('whatsapp_connect_started')[1].props!.attemptId)
  })
})

describe('finish shapes reach the server', () => {
  it('FINISH_ONLY_WABA: no phone id, the account goes up and the server looks for a number', async () => {
    const { done, callback } = launch()
    meta('FINISH_ONLY_WABA', { waba_id: 'W1' })
    callback({ authResponse: { code: 'c' } })
    await act(async () => { await done })
    expect(postedBody()).toMatchObject({ code: 'c', wabaId: 'W1', onboardingType: 'cloud_api' })
    expect(postedBody().phoneNumberId).toBeUndefined()
  })

  it('several accounts: no longer dropped as missing details, all go up as candidates', async () => {
    const { done, callback } = launch()
    meta('FINISH', { messaging_account_ids: ['W1', 'W2'], phone_number_id: 'P1' })
    callback({ authResponse: { code: 'c' } })
    let result!: EmbeddedSignupResult
    await act(async () => { result = await done })
    expect(result.ok).toBe(true)
    expect(postedBody()).toMatchObject({ code: 'c', wabaCandidates: ['W1', 'W2'], phoneNumberId: 'P1' })
    expect(failures()).toHaveLength(0)
  })

  it('a server failure that kept the token comes back resumable', async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ ok: false, error: 'subscribe_incomplete', resumable: true }), { status: 502 })) as unknown as typeof fetch
    const { done, callback } = launch()
    meta('FINISH', { waba_id: 'W1', phone_number_id: 'P1' })
    callback({ authResponse: { code: 'c' } })
    let result!: EmbeddedSignupResult
    await act(async () => { result = await done })
    expect(result).toEqual({ ok: false, error: 'subscribe_incomplete', resumable: true })
  })

  it('resume posts nothing from the browser and opens no window', async () => {
    const { result } = renderHook(() => useEmbeddedSignup('123', 'cfg_1', 'v21.0'))
    let resumed!: EmbeddedSignupResult
    await act(async () => { resumed = await result.current.resume() })
    expect(resumed.ok).toBe(true)
    expect(FB.login).not.toHaveBeenCalled()
    expect(global.fetch).toHaveBeenCalledWith('/api/whatsapp/embedded-signup/resume', { method: 'POST' })
  })
})
