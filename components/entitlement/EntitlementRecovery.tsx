'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAccessDenied } from '@/lib/entitlement/EntitlementContext'
import { clearAccessDenied } from '@/lib/entitlement/pollGate'
import { getEntitlementStatus } from '@/actions/subscription'

/**
 * The other tab.
 *
 * THE PROBLEM. `EntitlementProvider` is seeded once, on the server, when the app
 * layout renders. App Router layouts do not re-render on client navigation, so a
 * tab that was opened while the subscription was lapsed keeps `hasAccess: false`
 * for as long as it stays open — and `pollGate` has latched too. A customer who
 * pays in a second tab and returns to this one finds a product that still looks
 * expired, with no cure short of a manual reload or a logout.
 *
 * THE FIX, and why it is this small. Nothing here decides entitlement: it asks
 * the server the one question it is allowed to ask and, only on a POSITIVE
 * confirmation, clears the stale client latch and calls `router.refresh()`.
 * The refresh re-runs the app layout on the server, which re-seeds the provider
 * from `getAgencyProductAccess`. That is what makes every Pro surface drop the
 * expired state at once, without a reload.
 *
 * IT COSTS A PAYING CUSTOMER NOTHING. The effect returns immediately unless the
 * client currently believes access is DENIED, so the overwhelming majority of
 * sessions never attach a listener or issue a single call. For a lapsed session
 * it fires only when the tab is actually brought back into view, and no more
 * often than the throttle allows — not on a timer, and never as a poll.
 *
 * A negative or failed answer changes nothing at all: it cannot revoke access,
 * it cannot re-latch the gate, and it never renders. Recovery only ever moves
 * in the direction of unlocking, and only when the server says so.
 */

/** Don't re-ask on every alt-tab. */
const THROTTLE_MS = 10_000

export default function EntitlementRecovery() {
  const denied = useAccessDenied()
  const router = useRouter()

  useEffect(() => {
    if (!denied) return

    let lastCheck = 0
    let cancelled = false

    async function recheck() {
      if (cancelled) return
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      const now = Date.now()
      if (now - lastCheck < THROTTLE_MS) return
      lastCheck = now
      try {
        const res = await getEntitlementStatus()
        if (cancelled || !res.active) return
        clearAccessDenied()
        router.refresh()
      } catch {
        // A failed lookup is not a lapsed subscription. Leave everything as is.
      }
    }

    document.addEventListener('visibilitychange', recheck)
    window.addEventListener('focus', recheck)
    // The customer may already be looking at this tab when it re-mounts.
    recheck()

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', recheck)
      window.removeEventListener('focus', recheck)
    }
  }, [denied, router])

  return null
}
