'use client'
import { useCallback, useEffect, useRef } from 'react'
import {
  createEmbeddedSignupGate,
  parseEmbeddedSignupMessage,
  type EmbeddedSignupGate,
} from '@/lib/facebook/embeddedSignupSession'

declare global {
  interface Window {
    FB?: {
      init: (params: { appId: string; cookie?: boolean; xfbml?: boolean; version: string }) => void
      login: (
        cb: (response: { authResponse?: { code?: string } | null; status?: string }) => void,
        opts: Record<string, unknown>,
      ) => void
    }
    fbAsyncInit?: () => void
  }
}

const SDK_SRC = 'https://connect.facebook.net/en_US/sdk.js'

/**
 * How long `launch` may wait for `FB.init()` when the SDK is not ready yet.
 *
 * Short on purpose. The 5-minute LAUNCH_TIMEOUT_MS below bounds the whole
 * flow INCLUDING the customer's time inside Meta's popup; this bounds only the
 * script/init step, which either happens in a second or is not going to happen.
 * Making the customer wait five minutes to learn the SDK never loaded would be
 * the wrong trade.
 */
const SDK_READY_TIMEOUT_MS = 15_000

/**
 * SDK readiness, tracked at MODULE scope because `window.FB` is global — a
 * per-component ref would forget what another mount already established.
 *
 * `window.FB` existing is NOT the same as `FB.init()` having run. Between the
 * script executing and `fbAsyncInit` firing there is a window in which
 * `window.FB` is truthy but the SDK is uninitialised, and `FB.login` on an
 * uninitialised SDK opens no popup and never invokes its callback — an
 * indefinite hang with no error. Observed in production 2026-08-30.
 */
let sdkReady = false
let sdkReadyPromise: Promise<void> | null = null
let resolveSdkReady: (() => void) | null = null

function sdkReadySignal(): Promise<void> {
  if (!sdkReadyPromise) {
    sdkReadyPromise = new Promise<void>((res) => {
      resolveSdkReady = res
    })
  }
  return sdkReadyPromise
}

/** Called only from `init`, i.e. strictly after `FB.init()` returns. */
function markSdkReady(): void {
  sdkReady = true
  sdkReadySignal()
  resolveSdkReady?.()
}

/** Resolves true once `FB.init()` has run, or false if `timeoutMs` elapses first. */
function waitForSdkReady(timeoutMs: number): Promise<boolean> {
  if (sdkReady) return Promise.resolve(true)
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs)
    void sdkReadySignal().then(() => {
      clearTimeout(timer)
      resolve(true)
    })
  })
}

/** Test seam: reset the module-level readiness latch. */
export function __resetSdkReadyForTests(): void {
  sdkReady = false
  sdkReadyPromise = null
  resolveSdkReady = null
}

/**
 * Opt into the WhatsApp Business App coexistence flow.
 *
 * With no feature type, Meta runs the default Cloud API flow, which for a number
 * already live on the WhatsApp Business app can only end one way: "you must
 * either delete your account, or onboard to the platform using a solution
 * provider who supports business app number onboarding." Customers chose their
 * WhatsApp Business app over us, every time.
 *
 * Setting this replaces the WABA selection screen with an option to connect the
 * existing WhatsApp Business account, keeping both working on one number.
 */
const COEXISTENCE_FEATURE_TYPE = 'whatsapp_business_app_onboarding'

/**
 * Targeted off-switch for the line above, and only that line.
 *
 * This is the one change here that cannot be verified before production:
 * Facebook Login runs only on the app's allowlisted domain, so Embedded Signup
 * cannot be exercised on a preview deployment. If Meta rejects this feature type
 * on our Login configuration, the failure would not be limited to Business app
 * users — it could block onboarding for everyone.
 *
 * Set `NEXT_PUBLIC_WA_COEXISTENCE_DISABLED=1` to fall back to production's
 * previous behaviour while keeping the rest of this feature (phone-number
 * resolution, the echo guard, the registration skip) intact. Requires a
 * redeploy, since Next.js inlines NEXT_PUBLIC_* at build time — but it is a
 * config flip and rebuild rather than a code revert and review.
 */
const COEXISTENCE_DISABLED = process.env.NEXT_PUBLIC_WA_COEXISTENCE_DISABLED === '1'

/**
 * Safety valve only. Starts AFTER the OAuth code exists. Does not bound how
 * long the customer may spend inside Meta's popup.
 */
const SESSION_INFO_WAIT_MS = 8_000

/**
 * Outer bound on the WHOLE launch promise.
 *
 * Every `resolve` path lives inside `FB.login`'s callback. If the SDK never
 * invokes it — a blocked popup, a dialog dismissed through browser chrome
 * rather than Meta's own control, a dropped callback — the promise never
 * settles, `useAction`'s `finally` never runs, and the button spins forever
 * with no way back except reloading the page. Observed in production on
 * 2026-08-30.
 *
 * Five minutes, not one: a real Coexistence signup has the customer reading
 * screens, picking a business and entering an OTP inside Meta's popup. This is
 * a stuck-state valve, NOT a deadline for the customer, and cutting a genuine
 * flow short would be the worse failure.
 *
 * It resolves as `sdk`, whose existing notice already says exactly this —
 * "חלון ההתחברות לא נפתח", blocker/privacy reasons, retry action.
 */
const LAUNCH_TIMEOUT_MS = 300_000

export type EmbeddedSignupResult = { ok: boolean; error?: string; messagingReady?: boolean; reason?: string }

export function useEmbeddedSignup(appId: string, configId: string, graphVersion: string) {
  const gateRef = useRef<EmbeddedSignupGate | null>(null)

  useEffect(() => {
    if (!appId) return
    const init = () => {
      window.FB?.init({ appId, cookie: true, xfbml: false, version: graphVersion })
      markSdkReady()
    }
    sdkReadySignal()
    // Registered BEFORE anything else, and unconditionally. Previously this ran
    // only on the not-yet-loaded branch, so a script tag that already existed
    // with init still pending had nothing left to call it.
    window.fbAsyncInit = init
    if (window.FB) {
      init()
      return
    }
    if (!document.getElementById('facebook-jssdk')) {
      const s = document.createElement('script')
      s.id = 'facebook-jssdk'
      s.src = SDK_SRC
      s.async = true
      s.defer = true
      s.crossOrigin = 'anonymous'
      document.body.appendChild(s)
    }
  }, [appId, graphVersion])

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const session = parseEmbeddedSignupMessage(event.origin, event.data)
      if (!session) return
      gateRef.current?.acceptSession(session)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  const launch = useCallback(async (): Promise<EmbeddedSignupResult> => {
    // `window.FB` existing does not mean `FB.init()` has run, and FB.login on an
    // uninitialised SDK never calls back — the UI just spins forever. Gate on
    // real readiness instead, bounded so a script that never loads becomes a
    // normal 'sdk' error rather than a five-minute hang.
    //
    // When the SDK IS ready this hits no `await`, so the promise executor — and
    // therefore FB.login — still runs synchronously inside the click handler.
    // That matters: an await here would spend the user-activation token and the
    // browser would block the popup.
    if (!sdkReady && !(await waitForSdkReady(SDK_READY_TIMEOUT_MS))) {
      return { ok: false, error: 'sdk' }
    }
    return new Promise((resolve) => {
      // A Promise ignores every resolve after the first, so the timeout and a
      // late callback cannot fight: whichever lands first wins and the other is
      // a no-op. `settle` exists only to clear the timer so a completed launch
      // leaves nothing pending.
      let timer: ReturnType<typeof setTimeout> | undefined
      const settle = (result: EmbeddedSignupResult) => {
        if (timer !== undefined) clearTimeout(timer)
        resolve(result)
      }
      timer = setTimeout(() => settle({ ok: false, error: 'sdk' }), LAUNCH_TIMEOUT_MS)

      try {
        if (!window.FB) return settle({ ok: false, error: 'sdk' })
        if (!configId) return settle({ ok: false, error: 'config' })
        const gate = createEmbeddedSignupGate()
        gateRef.current = gate
        // FB.login requires a SYNCHRONOUS callback. Handing the SDK an async
        // function makes it throw synchronously, which upstream swallows into a
        // generic error and the signup popup never opens. Keep the callback sync
        // and run the async work in an IIFE; settle() stays in closure scope so
        // the flow is unchanged.
        window.FB.login(
          (response) => {
            void (async () => {
              const code = response?.authResponse?.code
              if (!code) {
                gate.cancel()
                return settle({ ok: false, error: 'cancelled' })
              }
              gate.acceptCode(code)
              // Wait for session-info if it has not already arrived. The timer
              // is a safety valve for "code without waba_id", not a wait for
              // the customer to finish the popup.
              const timer = setTimeout(() => gate.expire(), SESSION_INFO_WAIT_MS)
              const outcome = await gate.outcome
              clearTimeout(timer)
              if (outcome.kind === 'cancelled') return settle({ ok: false, error: 'cancelled' })
              if (outcome.kind === 'error') return settle({ ok: false, error: outcome.error })
              try {
                const res = await fetch('/api/whatsapp/embedded-signup', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    code: outcome.code,
                    wabaId: outcome.session.waba_id,
                    phoneNumberId: outcome.session.phone_number_id,
                    onboardingType: outcome.session.onboardingType,
                  }),
                })
                const body = (await res.json().catch(() => ({}))) as {
                  error?: string
                  messagingReady?: boolean
                  reason?: string
                }
                if (!res.ok) {
                  return settle({ ok: false, error: body.error ?? 'server' })
                }
                settle({ ok: true, messagingReady: body.messagingReady, reason: body.reason })
              } catch {
                settle({ ok: false, error: 'network' })
              }
            })()
          },
          {
            config_id: configId,
            response_type: 'code',
            override_default_response_type: true,
            extras: {
              version: 'v4',
              featureType: COEXISTENCE_DISABLED ? '' : COEXISTENCE_FEATURE_TYPE,
            },
          },
        )
      } catch {
        // A synchronous throw from FB.login must surface as a real, mappable
        // error — never the generic "something went wrong".
        settle({ ok: false, error: 'sdk' })
      }
    })
  }, [configId])

  return { launch }
}
