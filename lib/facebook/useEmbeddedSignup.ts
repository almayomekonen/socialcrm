'use client'
import { useCallback, useEffect, useRef } from 'react'
import { ES_EVENT_FINISH, ES_EVENT_FINISH_COEXISTENCE, type OnboardingType } from '@/lib/whatsapp/coexistence'

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
const FB_HOSTS = new Set(['www.facebook.com', 'web.facebook.com', 'business.facebook.com'])

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

export type EmbeddedSignupResult = { ok: boolean; error?: string; messagingReady?: boolean; reason?: string }
type EmbeddedSignupData = { waba_id?: string; phone_number_id?: string; onboardingType: OnboardingType }

/**
 * Meta's own sample accepts any origin where `origin.endsWith('facebook.com')`,
 * which also matches `https://evilfacebook.com`. We validate the parsed hostname
 * instead: exact known hosts, or a true `*.facebook.com` subdomain, over HTTPS.
 * Stricter than the sample where it matters, broader where it must be — the
 * previous two-host allowlist risked silently dropping the coexistence event if
 * Meta served the flow from another Facebook host.
 */
function isFacebookOrigin(origin: string): boolean {
  try {
    const { protocol, hostname } = new URL(origin)
    if (protocol !== 'https:') return false
    return FB_HOSTS.has(hostname) || hostname.endsWith('.facebook.com')
  } catch {
    return false
  }
}

export function useEmbeddedSignup(appId: string, configId: string, graphVersion: string) {
  const esDataRef = useRef<EmbeddedSignupData>({ onboardingType: 'cloud_api' })

  useEffect(() => {
    if (!appId) return
    const init = () => window.FB?.init({ appId, cookie: true, xfbml: false, version: graphVersion })
    if (window.FB) {
      init()
      return
    }
    window.fbAsyncInit = init
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
      if (!isFacebookOrigin(event.origin)) return
      let parsed: unknown
      try {
        parsed = typeof event.data === 'string' ? JSON.parse(event.data) : event.data
      } catch {
        return
      }
      if (!parsed || typeof parsed !== 'object') return
      const msg = parsed as { type?: string; event?: string; data?: { waba_id?: string; phone_number_id?: string } }
      if (msg.type !== 'WA_EMBEDDED_SIGNUP') return

      // Meta emits a distinct completion event for the Business app flow. Both
      // are real successes; only the follow-up work differs, so the flow the
      // customer actually completed is recorded here rather than inferred later.
      if (msg.event === ES_EVENT_FINISH || msg.event === ES_EVENT_FINISH_COEXISTENCE) {
        esDataRef.current = {
          waba_id: msg.data?.waba_id,
          phone_number_id: msg.data?.phone_number_id,
          onboardingType: msg.event === ES_EVENT_FINISH_COEXISTENCE ? 'coexistence' : 'cloud_api',
        }
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  const launch = useCallback((): Promise<EmbeddedSignupResult> => {
    return new Promise((resolve) => {
      try {
        if (!window.FB) return resolve({ ok: false, error: 'sdk' })
        if (!configId) return resolve({ ok: false, error: 'config' })
        esDataRef.current = { onboardingType: 'cloud_api' }
        // FB.login requires a SYNCHRONOUS callback. Handing the SDK an async
        // function makes it throw synchronously, which upstream swallows into a
        // generic error and the signup popup never opens. Keep the callback sync
        // and run the async work in an IIFE; resolve() stays in closure scope so
        // the flow is unchanged.
        window.FB.login(
          (response) => {
            void (async () => {
              const code = response?.authResponse?.code
              if (!code) return resolve({ ok: false, error: 'cancelled' })
              try {
                const res = await fetch('/api/whatsapp/embedded-signup', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    code,
                    wabaId: esDataRef.current.waba_id,
                    phoneNumberId: esDataRef.current.phone_number_id,
                    onboardingType: esDataRef.current.onboardingType,
                  }),
                })
                const body = (await res.json().catch(() => ({}))) as {
                  error?: string
                  messagingReady?: boolean
                  reason?: string
                }
                if (!res.ok) {
                  return resolve({ ok: false, error: body.error ?? 'server' })
                }
                resolve({ ok: true, messagingReady: body.messagingReady, reason: body.reason })
              } catch {
                resolve({ ok: false, error: 'network' })
              }
            })()
          },
          {
            config_id: configId,
            response_type: 'code',
            override_default_response_type: true,
            extras: {
              setup: {},
              featureType: COEXISTENCE_DISABLED ? '' : COEXISTENCE_FEATURE_TYPE,
              sessionInfoVersion: '3',
            },
          },
        )
      } catch {
        // A synchronous throw from FB.login must surface as a real, mappable
        // error — never the generic "something went wrong".
        resolve({ ok: false, error: 'sdk' })
      }
    })
  }, [configId])

  return { launch }
}
