'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { copyToClipboard } from '@/lib/clipboard'
import { trackActivation } from '@/actions/activation'
import {
  initialMachine,
  oauthPendingMachine,
  reducer,
  deriveReturnEvent,
  type ActivationMachine,
  type ActivationEvent,
  type ActivationContext,
  type FacebookPage,
} from '@/lib/activation/activationState'

const LOGIN_URL = 'https://getsocialcrm.com'
const OAUTH_URL = '/api/auth/facebook?origin=activation'

function clearActivationParam(): void {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  if (!url.searchParams.has('activation')) return
  url.searchParams.delete('activation')
  url.searchParams.delete('reason')
  window.history.replaceState({}, '', url.pathname + url.search + url.hash)
}

export function useActivationController({
  initialPages,
  alreadyConnected,
}: {
  initialPages: FacebookPage[]
  alreadyConnected: boolean
}) {
  const params = useSearchParams()
  const [machine, setMachine] = useState<ActivationMachine>(initialMachine)
  const machineRef = useRef<ActivationMachine>(initialMachine)
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

  useEffect(() => {
    if (bootRef.current) return
    bootRef.current = true
    if (alreadyConnected) {
      clearActivationParam()
      return
    }
    const event = deriveReturnEvent(new URLSearchParams(params.toString()), initialPages)
    if (!event) return
    const next = apply(oauthPendingMachine, event)
    if (event.type === 'RETURN_SUCCEEDED') void trackActivation('oauth_completed')
    if (event.type === 'RETURN_CANCELLED') void trackActivation('activation_abandoned')
    if (next.status === 'subscribingPage') void performSubscription(next.context)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const startOAuth = useCallback(() => {
    void trackActivation('activation_started')
    window.location.href = OAUTH_URL
  }, [])

  const selectPage = useCallback(
    (pageId: string) => {
      const next = apply(machineRef.current, { type: 'PAGE_SELECTED', pageId })
      if (next.status === 'subscribingPage') void performSubscription(next.context)
    },
    [apply, performSubscription],
  )

  const retry = useCallback(() => {
    apply(machineRef.current, { type: 'RETRY' })
    startOAuth()
  }, [apply, startOAuth])

  const continueDesktop = useCallback(async (): Promise<boolean> => {
    return copyToClipboard(LOGIN_URL)
  }, [])

  return { machine, startOAuth, selectPage, retry, continueDesktop }
}
