'use client'

import { useEffect, useRef } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'

/**
 * Registration redirects to /leads?welcome=<firstName>. Nothing reads that
 * param any more — the greeting toast it used to fire was removed — but the
 * redirect in `actions/agencies.ts` still sets it, and a percent-encoded Hebrew
 * name sitting in the address bar is the first thing a new user would see.
 * This strips it and nothing else.
 *
 * The CompleteRegistration pixel does NOT live here. It is in
 * <RegistrationConversion/>, which the (app) layout mounts unconditionally,
 * because this component only renders once the trial gate lets /leads render
 * at all.
 */
export default function WelcomeParamCleanup() {
  const router = useRouter()
  const pathname = usePathname()
  const search = useSearchParams()
  const firedRef = useRef(false)

  useEffect(() => {
    if (firedRef.current) return
    if (search.get('welcome') === null) return
    firedRef.current = true

    const next = new URLSearchParams(search.toString())
    next.delete('welcome')
    const qs = next.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [search, router, pathname])

  return null
}
