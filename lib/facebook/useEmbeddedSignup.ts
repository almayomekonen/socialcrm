'use client'
import { useCallback, useEffect, useRef } from 'react'

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
const FB_ORIGINS = ['https://www.facebook.com', 'https://web.facebook.com']

// TEMP DIAGNOSTIC — remove after the Embedded Signup popup issue is resolved.
// Logs every stage to the browser console under the [ES DEBUG] prefix.
const dbg = (...args: unknown[]) => console.log('[ES DEBUG]', ...args)
const mask = (v: string) => (v ? `${v.slice(0, 4)}…${v.slice(-4)} (len ${v.length})` : '(EMPTY)')
const errText = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}` : String(e))

export type EmbeddedSignupResult = {
  ok: boolean
  error?: string
  detail?: string
  messagingReady?: boolean
  reason?: string
}
type EmbeddedSignupData = { waba_id?: string; phone_number_id?: string }

export function useEmbeddedSignup(appId: string, configId: string, graphVersion: string) {
  const esDataRef = useRef<EmbeddedSignupData>({})

  // Load + init the FB JS SDK.
  useEffect(() => {
    if (!appId) {
      dbg('init effect: appId is EMPTY — SDK cannot init', { configId, graphVersion })
      return
    }
    const init = () => {
      dbg('3. FB.init called', { appId: mask(appId), configId, graphVersion, hasFB: !!window.FB })
      try {
        window.FB?.init({ appId, cookie: true, xfbml: false, version: graphVersion })
        dbg('   FB.init OK')
      } catch (e) {
        dbg('   FB.init THREW:', errText(e), e)
      }
    }
    if (window.FB) {
      dbg('2. SDK already present on window.FB')
      init()
      return
    }
    window.fbAsyncInit = () => {
      dbg('2. SDK loaded — fbAsyncInit fired')
      init()
    }
    if (!document.getElementById('facebook-jssdk')) {
      dbg('1. SDK loading started', { src: SDK_SRC })
      const s = document.createElement('script')
      s.id = 'facebook-jssdk'
      s.src = SDK_SRC
      s.async = true
      s.defer = true
      s.crossOrigin = 'anonymous'
      s.onload = () => dbg('   SDK <script> onload')
      s.onerror = (e) => dbg('   SDK <script> ONERROR — failed to load (CSP/network?)', e)
      document.body.appendChild(s)
    } else {
      dbg('1. SDK <script> already in DOM, waiting for fbAsyncInit')
    }
  }, [appId, configId, graphVersion])

  // Capture the WABA + phone ids the Embedded Signup flow emits via postMessage.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!FB_ORIGINS.includes(event.origin)) return
      let parsed: unknown
      try {
        parsed = typeof event.data === 'string' ? JSON.parse(event.data) : event.data
      } catch {
        return
      }
      if (!parsed || typeof parsed !== 'object') return
      const msg = parsed as { type?: string; event?: string; data?: EmbeddedSignupData }
      if (msg.type === 'WA_EMBEDDED_SIGNUP') dbg('   WA_EMBEDDED_SIGNUP message', msg.event, msg.data)
      if (msg.type === 'WA_EMBEDDED_SIGNUP' && msg.event === 'FINISH') {
        esDataRef.current = { waba_id: msg.data?.waba_id, phone_number_id: msg.data?.phone_number_id }
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  const launch = useCallback((): Promise<EmbeddedSignupResult> => {
    return new Promise((resolve) => {
      try {
        dbg('4. appId', mask(appId))
        dbg('5. configId', configId || '(EMPTY)')
        dbg('   window.FB present?', !!window.FB, '| FB.login is fn?', typeof window.FB?.login)
        if (!window.FB) {
          return resolve({ ok: false, error: 'sdk', detail: 'window.FB is undefined (SDK not loaded/initialized)' })
        }
        if (!configId) {
          return resolve({ ok: false, error: 'config', detail: 'configId is empty (env var not set on this deploy?)' })
        }
        esDataRef.current = {}
        dbg('6. before FB.login()', {
          config_id: configId,
          response_type: 'code',
          override_default_response_type: true,
        })
        window.FB.login(
          // FB.login requires a SYNCHRONOUS callback. Run the async work inside an
          // IIFE so we never hand the SDK an async function (the synchronous throw).
          // resolve() stays in closure scope — flow and business logic are unchanged.
          (response) => {
            void (async () => {
              dbg('7. FB.login callback fired', { hasAuthResponse: !!response?.authResponse, status: response?.status })
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
                  }),
                })
                const body = (await res.json().catch(() => ({}))) as {
                  error?: string
                  messagingReady?: boolean
                  reason?: string
                }
                dbg('   backend response', res.status, body)
                if (!res.ok) {
                  return resolve({ ok: false, error: body.error ?? 'server', detail: `backend ${res.status}` })
                }
                resolve({ ok: true, messagingReady: body.messagingReady, reason: body.reason })
              } catch (e) {
                dbg('8. backend fetch THREW:', errText(e), e)
                resolve({ ok: false, error: 'network', detail: errText(e) })
              }
            })()
          },
          {
            config_id: configId,
            response_type: 'code',
            override_default_response_type: true,
            extras: { setup: {}, featureType: '', sessionInfoVersion: '3' },
          },
        )
        dbg('   FB.login() invoked without a synchronous throw (popup should be opening)')
      } catch (e) {
        // 8/9 — the real exception that useAction was swallowing into the generic message.
        dbg('8/9. FB.login THREW synchronously:', errText(e), e)
        resolve({ ok: false, error: 'exception', detail: errText(e) })
      }
    })
  }, [appId, configId])

  return { launch }
}
