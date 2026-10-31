'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from '@/lib/toast'
import { useT } from '@/lib/i18n/I18nProvider'
import { shouldAutoCompleteFacebook, shouldAutoCompleteWhatsapp } from './oauthReturn'

type FacebookPage = { id: string; name: string }
type WhatsappPhone = { id: string; displayPhone: string; verifiedName: string }

/**
 * After an external OAuth return, complete the existing one-item connect POST
 * (the same routes FacebookConnect / WhatsappConnect already call) so the user
 * is not asked to tap Connect again. Multi-item pickers stay in the sheet.
 */
export function useIntegrationReturnContinuation(input: {
  facebookConnected: boolean
  pendingPages: FacebookPage[] | null
  whatsappConnected: boolean
  pendingPhones: WhatsappPhone[] | null
  calendarConnecting: boolean
  calendarConnected: boolean
}) {
  const router = useRouter()
  const t = useT()
  /** The toasts in the interface language, read inside the effects without re-running them. */
  const tRef = useRef(t)
  tRef.current = t
  const [facebookCompleting, setFacebookCompleting] = useState(
    shouldAutoCompleteFacebook(input.pendingPages, input.facebookConnected),
  )
  const [whatsappCompleting, setWhatsappCompleting] = useState(
    shouldAutoCompleteWhatsapp(input.pendingPhones, input.whatsappConnected),
  )
  const calendarRefreshOnce = useRef(false)

  const fbPage =
    shouldAutoCompleteFacebook(input.pendingPages, input.facebookConnected) && input.pendingPages
      ? input.pendingPages[0]
      : null
  const waPhone =
    shouldAutoCompleteWhatsapp(input.pendingPhones, input.whatsappConnected) && input.pendingPhones
      ? input.pendingPhones[0]
      : null

  useEffect(() => {
    if (!fbPage) {
      setFacebookCompleting(false)
      return
    }
    setFacebookCompleting(true)
    const ac = new AbortController()
    ;(async () => {
      try {
        const res = await fetch('/api/auth/facebook/connect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // The Page id only — the server resolves the token from its own cookie.
          body: JSON.stringify({ pageId: fbPage.id }),
          signal: ac.signal,
        })
        if (ac.signal.aborted) return
        if (!res.ok) {
          toast('error', tRef.current('settings.mobile.oauth.fbCompleteFailed'))
          setFacebookCompleting(false)
          return
        }
        toast('success', tRef.current('settings.integrations.facebook.connected', { name: fbPage.name }))
        router.refresh()
      } catch (err) {
        if (ac.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) return
        toast('error', tRef.current('settings.mobile.oauth.fbCompleteFailed'))
        setFacebookCompleting(false)
      }
    })()
    return () => ac.abort()
  }, [fbPage?.id, fbPage?.name, router])

  useEffect(() => {
    if (!waPhone) {
      setWhatsappCompleting(false)
      return
    }
    setWhatsappCompleting(true)
    const ac = new AbortController()
    ;(async () => {
      try {
        const res = await fetch('/api/auth/whatsapp/connect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phoneNumberId: waPhone.id }),
          signal: ac.signal,
        })
        if (ac.signal.aborted) return
        if (!res.ok) {
          toast('error', tRef.current('settings.mobile.oauth.waCompleteFailed'))
          setWhatsappCompleting(false)
          return
        }
        toast('success', tRef.current('settings.mobile.oauth.waConnected'))
        router.refresh()
      } catch (err) {
        if (ac.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) return
        toast('error', tRef.current('settings.mobile.oauth.waCompleteFailed'))
        setWhatsappCompleting(false)
      }
    })()
    return () => ac.abort()
  }, [waPhone?.id, router])

  useEffect(() => {
    if (calendarRefreshOnce.current) return
    if (!input.calendarConnecting || input.calendarConnected) return
    calendarRefreshOnce.current = true
    router.refresh()
  }, [input.calendarConnecting, input.calendarConnected, router])

  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) router.refresh()
    }
    window.addEventListener('pageshow', onPageShow)
    return () => window.removeEventListener('pageshow', onPageShow)
  }, [router])

  return { facebookCompleting, whatsappCompleting }
}
