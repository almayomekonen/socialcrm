'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from '@/lib/toast'
import { shouldAutoCompleteFacebook, shouldAutoCompleteWhatsapp } from './oauthReturn'

type FacebookPage = { id: string; name: string; access_token: string }
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
          body: JSON.stringify({
            pageId: fbPage.id,
            pageName: fbPage.name,
            pageAccessToken: fbPage.access_token,
          }),
          signal: ac.signal,
        })
        if (ac.signal.aborted) return
        if (!res.ok) {
          toast('error', 'לא הצלחנו להשלים את חיבור פייסבוק. אפשר לבחור דף ידנית.')
          setFacebookCompleting(false)
          return
        }
        toast('success', `הדף "${fbPage.name}" חובר בהצלחה`)
        router.refresh()
      } catch (err) {
        if (ac.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) return
        toast('error', 'לא הצלחנו להשלים את חיבור פייסבוק. אפשר לבחור דף ידנית.')
        setFacebookCompleting(false)
      }
    })()
    return () => ac.abort()
  }, [fbPage?.id, fbPage?.name, fbPage?.access_token, router])

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
          toast('error', 'לא הצלחנו להשלים את חיבור הוואטסאפ. אפשר לבחור מספר ידנית.')
          setWhatsappCompleting(false)
          return
        }
        toast('success', 'וואטסאפ חובר בהצלחה')
        router.refresh()
      } catch (err) {
        if (ac.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) return
        toast('error', 'לא הצלחנו להשלים את חיבור הוואטסאפ. אפשר לבחור מספר ידנית.')
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
