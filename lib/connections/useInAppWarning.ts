'use client'
import { useState } from 'react'
import type { InAppBrowser } from '@/lib/device'

export type { InAppBrowser }

/**
 * First connect tap inside Instagram's in-app browser warns instead of opening
 * Meta; the next tap goes through.
 *
 * INSTAGRAM ONLY, on evidence. The one observed in-app failure is Instagram
 * (agency 149: seven Meta dialogs, none returned). Facebook's in-app browser is
 * the opposite: agencies 142 and 147 signed up on phones from facebook.com links
 * and completed Facebook OAuth there. Warning them would add friction to the one
 * mobile path that works. 'facebook' is still detected and recorded as `inApp`
 * on the connect events, so extending this is a data decision, not a guess.
 *
 * A warning, never a gate. User-Agent detection can be wrong, and a false
 * positive must not lock anyone out of connecting — so the notice's own action
 * is "try anyway", and it works.
 */
export function useInAppWarning(inAppBrowser: InAppBrowser | undefined) {
  const [warned, setWarned] = useState(false)

  const intercept = (): boolean => {
    if (inAppBrowser !== 'instagram' || warned) return false
    setWarned(true)
    return true
  }

  return { warned, intercept }
}
