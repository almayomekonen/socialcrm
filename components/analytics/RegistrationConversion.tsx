'use client'

import { useEffect, useRef } from 'react'
import { trackCompleteRegistration } from '@/lib/facebook/pixelEvents'

/**
 * The CompleteRegistration conversion, decoupled from the URL and the trial gate.
 *
 * WHY THIS EXISTS. The event used to key off `?welcome=`, and two separate
 * redirects destroyed it: the (app) layout renders WorkspaceTeaser INSTEAD of
 * {children} while the trial is NEVER_STARTED — which every brand-new agency is
 * — so /leads never rendered its emitter until the user activated a trial; and
 * /activate bounces an onboarded, allowlisted phone to /dashboard, with
 * redirect() dropping the query string on the way. No phone fired the event at
 * all, and desktop fired it late or never.
 *
 * The signal is now a short-lived cookie set in `addAgency()` (`scrm_reg`,
 * value = the new user id), which survives redirects and layout branches alike.
 * This component is therefore mounted UNCONDITIONALLY — outside every trial and
 * device conditional — and self-gates on the cookie's presence.
 *
 * THE KEY IS SHARED ON PURPOSE. `socialcrm:completeRegFired:` is the same
 * localStorage prefix `components/activation/RegistrationPixel.tsx` uses.
 * Sharing it is what lets both emitters stay mounted without double counting:
 * whichever runs first marks the id, the other sees the mark and stays silent.
 *
 * The cookie is deleted on EVERY path, including the already-fired one — a
 * cookie left behind would re-arm this on the next navigation, and the only
 * thing standing between that and a duplicate conversion would be localStorage,
 * which a private window does not keep.
 */

const FIRED_KEY_PREFIX = 'socialcrm:completeRegFired:'
const COOKIE_NAME = 'scrm_reg'

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}

function deleteCookie(name: string) {
  if (typeof document === 'undefined') return
  document.cookie = `${name}=; Max-Age=0; path=/`
}

export default function RegistrationConversion() {
  const ranRef = useRef(false)

  useEffect(() => {
    // StrictMode double-invokes effects in development; this makes the run
    // once-per-mount, and the localStorage mark makes it once-per-user.
    if (ranRef.current) return
    ranRef.current = true

    const userId = readCookie(COOKIE_NAME)
    if (!userId) return

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

    deleteCookie(COOKIE_NAME)
  }, [])

  return null
}
