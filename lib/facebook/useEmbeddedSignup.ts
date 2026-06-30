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
      if (!window.FB) return resolve({ ok: false, error: 'sdk' })
      if (!configId) return resolve({ ok: false, error: 'config' })
      esDataRef.current = {}
      window.FB.login(
        async (response) => {
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
        },
        {
          config_id: configId,
          response_type: 'code',
          override_default_response_type: true,
          extras: { setup: {}, featureType: '', sessionInfoVersion: '3' },
        },
      )
    })
  }, [configId])

  return { launch }
}
