'use client'

import { useEffect, useRef } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { toast } from '@/lib/toast'
import { useUser } from '@/lib/hooksNEvents'

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
      // suppress the toast (one welcome, one state) but keep the seen-marker.
      //
      // The CompleteRegistration pixel used to fire here too. It moved to
      // <RegistrationConversion/>, which the (app) layout mounts
      // unconditionally, because this component only renders once the trial
      // gate lets /leads render at all. It cannot stay as a second emitter:
      // this dedups on `socialcrm:welcomeToastSeen:`, a DIFFERENT key from the
      // `socialcrm:completeRegFired:` one the conversion uses, so the two would
      // double count each other.
      if (!suppressGreeting) {
        const firstName = welcomeParam.trim()
        const greeting = firstName
          ? `🚀 ברוך הבא ל-SocialCRM, ${firstName}`
          : '🚀 ברוך הבא ל-SocialCRM'
        toast('success', `${greeting}\nהמערכת שלך מוכנה להתחלה`, TOAST_DURATION_MS)
      }
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
