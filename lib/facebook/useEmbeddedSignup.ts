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

export type EmbeddedSignupResult = { ok: boolean; error?: string; messagingReady?: boolean; reason?: string }
type EmbeddedSignupData = { waba_id?: string; phone_number_id?: string }

export function useEmbeddedSignup(appId: string, configId: string, graphVersion: string) {
  const esDataRef = useRef<EmbeddedSignupData>({})

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
      if (!FB_ORIGINS.includes(event.origin)) return
      let parsed: unknown
      try {
        parsed = typeof event.data === 'string' ? JSON.parse(event.data) : event.data
      } catch {
        return
      }
      if (!parsed || typeof parsed !== 'object') return
      const msg = parsed as { type?: string; event?: string; data?: EmbeddedSignupData }
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
        if (!window.FB) return resolve({ ok: false, error: 'sdk' })
        if (!configId) return resolve({ ok: false, error: 'config' })
        esDataRef.current = {}
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
            extras: { setup: {}, featureType: '', sessionInfoVersion: '3' },
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
