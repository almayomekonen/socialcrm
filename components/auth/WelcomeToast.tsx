'use client'

import { useEffect, useRef } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { toast } from '@/lib/toast'
import { useUser } from '@/lib/hooksNEvents'
import { trackCompleteRegistration } from '@/lib/facebook/pixelEvents'

const STORAGE_KEY_PREFIX = 'socialcrm:welcomeToastSeen:'
const TOAST_DURATION_MS = 5000

export default function WelcomeToast({ suppressGreeting = false }: { suppressGreeting?: boolean }) {
  const user = useUser()
  const router = useRouter()
  const pathname = usePathname()
  const search = useSearchParams()
  const firedRef = useRef(false)

  useEffect(() => {
    if (firedRef.current) return
    const welcomeParam = search.get('welcome')
    if (welcomeParam === null) return
    firedRef.current = true

    const key = STORAGE_KEY_PREFIX + (user?.id ?? 'anon')
    let alreadySeen = false
    try {
      alreadySeen = window.localStorage.getItem(key) === 'true'
    } catch {}

    if (!alreadySeen) {
      // When the Welcome Trial Modal is about to show, it IS the welcome —
      // suppress the toast (one welcome, one state) but keep the pixel and
      // the seen-marker so registration attribution never depends on trial UI.
      if (!suppressGreeting) {
        const firstName = welcomeParam.trim()
        const greeting = firstName
          ? `🚀 ברוך הבא ל-SocialCRM, ${firstName}`
          : '🚀 ברוך הבא ל-SocialCRM'
        toast('success', `${greeting}\nהמערכת שלך מוכנה להתחלה`, TOAST_DURATION_MS)
      }
      trackCompleteRegistration()
      try {
        window.localStorage.setItem(key, 'true')
      } catch {}
    }

    const next = new URLSearchParams(search.toString())
    next.delete('welcome')
    const qs = next.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [user?.id, search, router, pathname])

  return null
}
