'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { copyToClipboard } from '@/lib/clipboard'
import { wait } from '@/lib/funcs'
import { trackActivation, getActivationData } from '@/actions/activation'
import {
  initialMachine,
  oauthPendingMachine,
  reducer,
  deriveReturnEvent,
  type ActivationMachine,
  type ActivationEvent,
  type ActivationContext,
} from '@/lib/activation/activationState'

const LOGIN_URL = 'https://getsocialcrm.com'
const OAUTH_URL = '/api/auth/facebook?origin=activation'
// Brief, deliberate dwell so the loading button is clearly seen before we leave
// for Meta. Acknowledges the tap without meaningfully slowing navigation.
const CTA_DWELL_MS = 200
const DESKTOP_QUERY = '(min-width: 1000px)'

function clearActivationParam(): void {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  if (!url.searchParams.has('activation')) return
  url.searchParams.delete('activation')
  url.searchParams.delete('reason')
  window.history.replaceState({}, '', url.pathname + url.search + url.hash)
}

function isReturnParam(params: URLSearchParams): boolean {
  const a = params.get('activation')
  return a === 'select' || a === 'error'
}

export function useActivationController() {
  const params = useSearchParams()
  // The first screen is fully static: a fresh user starts in waitingForActivation,
  // an OAuth return starts in the 'finishing' loading state. Both are computed
  // synchronously from the URL (no server data) and need NOTHING async to render —
  // so the hero appears immediately, with no brand→pause→text stagger.
  const returning = isReturnParam(new URLSearchParams(params.toString()))
  const initial = returning ? oauthPendingMachine : initialMachine
  const [machine, setMachine] = useState<ActivationMachine>(() => initial)
  const machineRef = useRef<ActivationMachine>(initial)
  // null = data not resolved yet (render the flow); true/false once known.
  const [alreadyConnected, setAlreadyConnected] = useState<boolean | null>(null)
  const bootRef = useRef(false)
  const connectInFlight = useRef<AbortController | null>(null)

  const apply = useCallback((from: ActivationMachine, event: ActivationEvent): ActivationMachine => {
    const next = reducer(from, event)
    machineRef.current = next
    setMachine(next)
    return next
  }, [])

  const performSubscription = useCallback(
    async (ctx: ActivationContext): Promise<void> => {
      if (connectInFlight.current) return
      const page = ctx.pages.find((p) => p.id === ctx.selectedPageId)
      if (!page) {
        apply(machineRef.current, { type: 'SUBSCRIBE_FAILED', reason: 'no_page' })
        void trackActivation('subscription_failed')
        return
      }
      const ac = new AbortController()
      connectInFlight.current = ac
      try {
        const res = await fetch('/api/auth/facebook/connect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pageId: page.id, pageName: page.name, pageAccessToken: page.access_token }),
          signal: ac.signal,
        })
        if (res.ok) {
          apply(machineRef.current, { type: 'SUBSCRIBE_OK', pageName: page.name })
          void trackActivation('subscription_completed')
          clearActivationParam()
        } else {
          const data = await res.json().catch(() => ({}))
          apply(machineRef.current, { type: 'SUBSCRIBE_FAILED', reason: data?.error ?? 'connect_failed' })
          void trackActivation('subscription_failed')
        }
      } catch {
        apply(machineRef.current, { type: 'SUBSCRIBE_FAILED', reason: 'network' })
        void trackActivation('subscription_failed')
      } finally {
        connectInFlight.current = null
      }
    },
    [apply],
  )

  // Resolve the data-dependent facts in parallel, AFTER the static first paint.
  // Runs once, client-only, and never on desktop (the flow is desktop-hidden).
  useEffect(() => {
    if (bootRef.current) return
    bootRef.current = true
    if (typeof window !== 'undefined' && window.matchMedia(DESKTOP_QUERY).matches) return

    let cancelled = false
    ;(async () => {
      let data: { alreadyConnected: boolean; pendingPages: { id: string; name: string; access_token: string }[] }
      try {
        data = await getActivationData()
      } catch {
        // If the parallel read fails on a return, surface a retryable failure;
        // a fresh user is unaffected (stays on the static first screen).
        if (!cancelled && returning) apply(oauthPendingMachine, { type: 'RETURN_CANCELLED', reason: 'data_unavailable' })
        return
      }
      if (cancelled) return

      setAlreadyConnected(data.alreadyConnected)
      if (data.alreadyConnected) {
        clearActivationParam()
        return
      }

      const event = deriveReturnEvent(new URLSearchParams(params.toString()), data.pendingPages)
      if (!event) return // fresh user → stay on the static first screen
      const next = apply(oauthPendingMachine, event)
      if (event.type === 'RETURN_SUCCEEDED') void trackActivation('oauth_completed')
      if (event.type === 'RETURN_CANCELLED') void trackActivation('activation_abandoned')
      if (next.status === 'subscribingPage') void performSubscription(next.context)
    })()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Async so the loading button (which awaits this) stays visible for the dwell
  // before navigation. Navigation still fires as soon as the dwell elapses.
  const startOAuth = useCallback(async (): Promise<void> => {
    void trackActivation('activation_started')
    await wait(CTA_DWELL_MS)
    window.location.href = OAUTH_URL
  }, [])

  const selectPage = useCallback(
    (pageId: string) => {
      const next = apply(machineRef.current, { type: 'PAGE_SELECTED', pageId })
      if (next.status === 'subscribingPage') void performSubscription(next.context)
    },
    [apply, performSubscription],
  )

  // Return the promise so the retry button keeps its loading state through the dwell.
  const retry = useCallback((): Promise<void> => {
    apply(machineRef.current, { type: 'RETRY' })
    return startOAuth()
  }, [apply, startOAuth])

  const continueDesktop = useCallback(async (): Promise<boolean> => {
    return copyToClipboard(LOGIN_URL)
  }, [])

  return { machine, alreadyConnected, startOAuth, selectPage, retry, continueDesktop }
}
