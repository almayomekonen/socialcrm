'use client'

import { useEffect, useRef } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { trackCompleteRegistration } from '@/lib/facebook/pixelEvents'

const FIRED_KEY_PREFIX = 'socialcrm:completeRegFired:'

export default function RegistrationPixel({ userId }: { userId: number }) {
  const router = useRouter()
  const pathname = usePathname()
  const search = useSearchParams()
  const firedRef = useRef(false)

  useEffect(() => {
    if (firedRef.current) return
    if (search.get('welcome') === null) return
    firedRef.current = true

    const key = FIRED_KEY_PREFIX + userId
    let alreadyFired = false
    try {
      alreadyFired = window.localStorage.getItem(key) === 'true'
    } catch {}

    if (!alreadyFired) {
      trackCompleteRegistration()
      try {
        window.localStorage.setItem(key, 'true')
      } catch {}
    }

    const next = new URLSearchParams(search.toString())
    next.delete('welcome')
    const qs = next.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [userId, search, router, pathname])

  return null
}
