'use client'
import { useCallback, useEffect, useRef } from 'react'
import { recordLeadActionEvent } from '@/actions/analytics/recordLeadActionEvent'
import { beginConnectAttempt, reportAbandonedConnectAttempt, reportLateCancel, reportMetaEvent } from '@/lib/connections/connectAttemptTelemetry'
import {
  cancelledResult,
  createEmbeddedSignupGate,
  parseEmbeddedSignupCancel,
  parseEmbeddedSignupMessage,
  parseEmbeddedSignupShape,
  pendingAfter,
  signupResponseResult,
  type EmbeddedSignupGate,
  type EmbeddedSignupResult,
} from '@/lib/facebook/embeddedSignupSession'
import {
  ensureFacebookSdkScript,
  facebookSdkIsReady,
  initFacebookApp,
  waitForFacebookSdk,
} from '@/lib/facebook/facebookSdk'
import { embeddedSignupLaunch } from '@/lib/facebook/embeddedSignupLaunch'

/**
 * How long `launch` may wait for the real SDK bundle.
 *
 * Bounds only the script/init step. The 5-minute LAUNCH_TIMEOUT_MS below bounds
 * the whole flow including the customer's time inside Meta's popup.
 */
const SDK_READY_TIMEOUT_MS = 15_000

/**
 * Safety valve only. Starts AFTER the OAuth code exists. Does not bound how
 * long the customer may spend inside Meta's popup.
 */
const SESSION_INFO_WAIT_MS = 8_000

/**
 * When the button is released if no outcome has arrived.
 *
 * Every outcome lives inside `FB.login`'s callback. If the SDK never invokes it —
 * a blocked popup, a dialog dismissed through browser chrome rather than Meta's
 * own control, a dropped callback — the button would spin forever with no way
 * back except reloading the page. Observed in production on 2026-08-30.
 *
 * This is NOT a deadline for the customer and NOT a failure: see `pendingAfter`.
 * The window may still be open, and a callback after this still completes the
 * signup and updates the page.
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
      const shape = parseEmbeddedSignupShape(event.origin, event.data)
      if (!shape) return
      const cancel = parseEmbeddedSignupCancel(event.origin, event.data)
      reportMetaEvent(shape, cancel)
      const session = parseEmbeddedSignupMessage(event.origin, event.data)
      if (session) return gateRef.current?.acceptSession(session)
      if (!cancel) return
      gateRef.current?.acceptCancel(cancel)
      reportLateCancel(cancel)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  const launchFlow = useCallback(async (attemptId: string): Promise<EmbeddedSignupResult> => {
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
    void recordLeadActionEvent('whatsapp_connect_started', { attemptId })

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
    return new Promise((settle) => {
      try {
        if (!facebookSdkIsReady() || !window.FB) return settle({ ok: false, error: 'sdk' })
        if (!configId) return settle({ ok: false, error: 'config' })
        // Re-assert our app on the shared SDK, synchronously, in the same task
        // as the click. Another consumer may have bound AUTH_FACEBOOK_APP_ID.
        const launchParams = embeddedSignupLaunch(graphVersion)
        initFacebookApp(appId, launchParams.sdkVersion)
        // A retry replaces a pending attempt: its window is no longer the one we
        // are waiting for, so its gate stops accepting anything.
        gateRef.current?.cancel()
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
                    wabaCandidates: outcome.session.wabaCandidates,
                    attemptId,
                    phoneNumberId: outcome.session.phone_number_id,
                    onboardingType: outcome.session.onboardingType,
                  }),
                })
                settle(await signupResponseResult(res))
              } catch {
                settle({ ok: false, error: 'network' })
              }
            })()
          },
          {
            config_id: configId,
            response_type: 'code',
            override_default_response_type: true,
            extras: launchParams.extras,
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
    return pendingAfter(launchFlow(attempt.attemptId).then(attempt.finish), LAUNCH_TIMEOUT_MS, attempt.pending)
  }, [launchFlow])

  /**
   * Finishes a signup whose Meta part is already done (`result.resumable`). No
   * popup and no Meta flow: the server holds what it needs in a sealed cookie.
   */
  const resume = useCallback(async (): Promise<EmbeddedSignupResult> => {
    try {
      return await signupResponseResult(await fetch('/api/whatsapp/embedded-signup/resume', { method: 'POST' }))
    } catch {
      return { ok: false, error: 'network' }
    }
  }, [])

  /** Forgets a kept signup. Fire and forget, so a launch stays inside its click task. */
  const discardKept = useCallback(() => {
    void fetch('/api/whatsapp/embedded-signup/resume', { method: 'DELETE' }).catch(() => {})
  }, [])

  return { launch, resume, discardKept }
}
