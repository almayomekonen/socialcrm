// @vitest-environment jsdom
/**
 * End to end through the real hook with NEXT_PUBLIC_WA_EMBEDDED_SIGNUP_VERSION=v5
 * and a fake Facebook SDK: the SDK is initialised at a supported Graph version,
 * FB.login gets Meta's v5 extras, and a v5 completion (messaging_account_ids,
 * no waba_id) reaches /api/whatsapp/embedded-signup with the right WABA, phone
 * and Coexistence type. The default build stays v4 (embeddedSignupSdkReadiness).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'

vi.mock('@/actions/analytics/recordLeadActionEvent', () => ({ recordLeadActionEvent: vi.fn(async () => {}) }))

type LoginCb = (r: { authResponse?: { code?: string } | null }) => void
const fakeFB = () => ({ init: vi.fn(), login: vi.fn() })
let FB: ReturnType<typeof fakeFB>

async function mountV5() {
  vi.stubEnv('NEXT_PUBLIC_WA_EMBEDDED_SIGNUP_VERSION', 'v5')
  vi.resetModules()
  const { __resetFacebookSdkForTests } = await import('@/lib/facebook/facebookSdk')
  __resetFacebookSdkForTests()
  FB = fakeFB()
  ;(window as unknown as { FB: typeof FB }).FB = FB
  const { useEmbeddedSignup } = await import('@/lib/facebook/useEmbeddedSignup')
  return renderHook(() => useEmbeddedSignup('123', 'cfg_1', 'v19.0'))
}

beforeEach(() => {
  sessionStorage.clear()
  global.fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true, messagingReady: false, reason: 'coexistence_pending' }), { status: 200 })) as never
})
afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('Embedded Signup v5 launch', () => {
  it('initialises the SDK at v26.0 (not the expired v19.0) and sends exactly { version: "v5" }', async () => {
    const { result } = await mountV5()
    act(() => {
      void result.current.launch()
    })
    expect(FB.init).toHaveBeenCalledWith(expect.objectContaining({ appId: '123', version: 'v26.0' }))
    expect(FB.login.mock.calls[0][1]).toEqual({
      config_id: 'cfg_1',
      response_type: 'code',
      override_default_response_type: true,
      extras: { version: 'v5' },
    })
  })

  it('a v5 Coexistence completion posts the single messaging account id as the WABA', async () => {
    const { result } = await mountV5()
    let done!: Promise<unknown>
    act(() => {
      done = result.current.launch()
    })
    const callback = FB.login.mock.calls[0][0] as LoginCb
    window.dispatchEvent(new MessageEvent('message', {
      origin: 'https://www.facebook.com',
      data: JSON.stringify({
        type: 'WA_EMBEDDED_SIGNUP',
        event: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',
        data: { phone_number_id: 'P5', is_on_biz_app: true, messaging_account_ids: ['W5'], business_id: 'B5' },
      }),
    }))
    callback({ authResponse: { code: 'oauth-code' } })
    await act(async () => {
      await done
    })
    const post = vi.mocked(global.fetch).mock.calls.find(([url]) => String(url) === '/api/whatsapp/embedded-signup')
    expect(post).toBeTruthy()
    expect(JSON.parse(String((post![1] as RequestInit).body))).toEqual({ code: 'oauth-code', wabaId: 'W5', phoneNumberId: 'P5', onboardingType: 'coexistence', attemptId: expect.any(String) })
  })
})
