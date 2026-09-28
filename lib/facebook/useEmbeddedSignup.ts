'use client'
import { useCallback, useEffect, useRef } from 'react'
import { recordLeadActionEvent } from '@/actions/analytics/recordLeadActionEvent'
import { beginConnectAttempt, reportAbandonedConnectAttempt } from '@/lib/connections/connectAttemptTelemetry'
import {
  cancelledResult,
  createEmbeddedSignupGate,
  parseEmbeddedSignupCancel,
  parseEmbeddedSignupMessage,
  type EmbeddedSignupGate,
  type EmbeddedSignupResult,
} from '@/lib/facebook/embeddedSignupSession'
import {
  ensureFacebookSdkScript,
  facebookSdkIsReady,
  initFacebookApp,
  waitForFacebookSdk,
} from '@/lib/facebook/facebookSdk'

/**
 * How long `launch` may wait for the real SDK bundle.
 *
 * Bounds only the script/init step. The 5-minute LAUNCH_TIMEOUT_MS below bounds
 * the whole flow including the customer's time inside Meta's popup.
 */
const SDK_READY_TIMEOUT_MS = 15_000

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

/**
 * After the login callback comes back without a code, how long to wait for
 * Meta's CANCEL message saying why. Meta does not document which arrives first;
 * one second is invisible to the customer and keeps the reason when it trails.
 */
const CANCEL_DETAIL_GRACE_MS = 1_000

export type { EmbeddedSignupResult }

export function useEmbeddedSignup(appId: string, configId: string, graphVersion: string) {
  const gateRef = useRef<EmbeddedSignupGate | null>(null)

  useEffect(() => {
    if (!appId) return
    // Only get the loader onto the page. Binding OUR app is deliberately NOT
    // done here: the auth components call FB.init with AUTH_FACEBOOK_APP_ID from
    // their own effects, so a mount-time binding is whatever ran last. We assert
    // it synchronously at launch instead.
    ensureFacebookSdkScript()
  }, [appId])

  // An attempt left open by a reload or navigation is reported on this visit —
  // the only moment it can be. See pendingConnectAttempt.ts.
  useEffect(reportAbandonedConnectAttempt, [])

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const session = parseEmbeddedSignupMessage(event.origin, event.data)
      if (session) return gateRef.current?.acceptSession(session)
      const cancel = parseEmbeddedSignupCancel(event.origin, event.data)
      if (cancel) gateRef.current?.acceptCancel(cancel)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  const launchFlow = useCallback(async (): Promise<EmbeddedSignupResult> => {
    /**
     * DENOMINATOR of the WhatsApp connect funnel, and the only honest place for
     * it: this is the click, before the Meta dialog opens. `/api/auth/whatsapp`
     * also emits `whatsapp_connect_started`, but nothing in the product calls
     * that route — which is why production shows 0 of these against 53
     * `facebook_connect_started`.
     *
     * NOT awaited, and that is load-bearing, not laziness: the comment below
     * spells out that an await here spends the user-activation token and the
     * browser blocks the popup. Fire and forget only.
     */
    void recordLeadActionEvent('whatsapp_connect_started')

    // `window.FB` existing proves nothing: the loader stub installs a buffering
    // shim under that name, and FB.login on the shim is queued into
    // `FB.__buffer.calls` — no popup, no callback, no error. Gate on the REAL
    // bundle, bounded, so a load that never completes becomes a normal 'sdk'
    // error rather than a silent hang.
    //
    // When the SDK IS ready this hits no `await`, so the promise executor — and
    // therefore FB.login — still runs synchronously inside the click handler.
    // That matters: an await here would spend the user-activation token and the
    // browser would block the popup.
    if (!facebookSdkIsReady() && !(await waitForFacebookSdk(SDK_READY_TIMEOUT_MS))) {
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
      // `reason: 'timeout'` keeps the 'sdk' notice but lets analytics tell a
      // flow that never opened from one that opened and never came back.
      timer = setTimeout(() => settle({ ok: false, error: 'sdk', reason: 'timeout' }), LAUNCH_TIMEOUT_MS)

      try {
        if (!facebookSdkIsReady() || !window.FB) return settle({ ok: false, error: 'sdk' })
        if (!configId) return settle({ ok: false, error: 'config' })
        // Re-assert our app on the shared SDK, synchronously, in the same task
        // as the click. Another consumer may have bound AUTH_FACEBOOK_APP_ID.
        initFacebookApp(appId, graphVersion)
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
                gate.cancel(CANCEL_DETAIL_GRACE_MS)
                const ended = await gate.outcome
                return settle(cancelledResult(ended.kind === 'cancelled' ? ended.detail : undefined))
              }
              gate.acceptCode(code)
              // Wait for session-info if it has not already arrived. The timer
              // is a safety valve for "code without waba_id", not a wait for
              // the customer to finish the popup.
              const timer = setTimeout(() => gate.expire(), SESSION_INFO_WAIT_MS)
              const outcome = await gate.outcome
              clearTimeout(timer)
              if (outcome.kind === 'cancelled') return settle(cancelledResult(outcome.detail))
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
  }, [appId, configId, graphVersion])

  /**
   * Reports the outcomes only the browser can see — see
   * `CLIENT_CONNECT_FAILURE_REASONS`. `launchFlow()` is CALLED synchronously
   * here, so FB.login still runs inside the click task; only the report waits.
   */
  const launch = useCallback((): Promise<EmbeddedSignupResult> => {
    const attempt = beginConnectAttempt()
    return launchFlow().then(attempt.finish)
  }, [launchFlow])

  return { launch }
}
