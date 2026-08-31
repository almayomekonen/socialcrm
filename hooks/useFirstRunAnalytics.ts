'use client'

import { useCallback, useEffect, useRef } from 'react'
import { recordLeadActionEvent } from '@/actions/analytics/recordLeadActionEvent'

export type FirstRunSurface = 'mobile' | 'desktop'

/**
 * Instrumentation for the first-run screen — the one surface in the funnel that
 * emitted nothing at all.
 *
 * WHAT THIS ANSWERS. Production shows four consecutive mobile signups whose
 * entire event trace ends at `workspace_first_viewed`, ~5 seconds after
 * registration. That event is emitted by the (app) layout, once per agency, so
 * it could not tell us whether the first-run screen rendered, what it offered,
 * or whether anything was ever tapped. Three events close that hole.
 *
 * ONE HOOK, BOTH SURFACES. Desktop `LeadsFirstRun` and mobile
 * `LeadsFirstRunMobile` are deliberately different screens, but they are the
 * same funnel step. Splitting the instrumentation would let the two drift and
 * make the surface comparison — the entire point of the `surface` prop —
 * unreliable.
 */
export function useFirstRunAnalytics({
  surface,
  metaConnected,
  whatsappConnected,
}: {
  surface: FirstRunSurface
  metaConnected: boolean
  whatsappConnected: boolean
}) {
  /**
   * Set the moment the user commits to a connect path, so unmount is not
   * reported as a deferral. A ref, not state: flipping it must never re-render
   * a screen the user is in the middle of leaving.
   */
  const engagedRef = useRef(false)
  /** StrictMode double-invokes effects in development; this keeps one view = one event. */
  const viewedRef = useRef(false)

  const channels: string[] = []
  if (!whatsappConnected) channels.push('whatsapp')
  if (!metaConnected) channels.push('facebook')
  const channelKey = channels.join(',')

  useEffect(() => {
    if (viewedRef.current) return
    viewedRef.current = true

    // The screen rendered. THE denominator for first-run activation: an agency
    // with this event and nothing after it is the abandonment cohort.
    recordLeadActionEvent('first_run_viewed', { surface, metaConnected, whatsappConnected }).catch(() => {})

    /**
     * The channel offer was shown.
     *
     * On this screen the two events coincide, and that is fine — they are not
     * the same claim. `first_run_viewed` is about the SCREEN; this is about
     * WHICH channels were on offer, which already varies here (a Meta-connected
     * workspace is only offered WhatsApp) and will vary more as connect nudges
     * appear on other surfaces. Recording the channel list at the moment of the
     * offer is what makes `connection_offered → *_connect_started` a real ratio
     * rather than an assumption.
     */
    if (channels.length > 0) {
      recordLeadActionEvent('connection_offered', { surface, channels: channelKey }).catch(() => {})
    }
    // channelKey is a stable string derived from the two booleans in the deps.
  }, [surface, metaConnected, whatsappConnected, channelKey, channels.length])

  useEffect(() => {
    return () => {
      if (engagedRef.current) return
      if (channels.length === 0) return

      /**
       * KNOWN AND ACCEPTED LIMITATION — read this before trusting the number.
       *
       * This is a Server Action fired from a cleanup function. It reports a
       * user who navigated AWAY inside the app without starting a connect. It
       * does NOT reliably fire when the tab is closed, the app is backgrounded,
       * or the browser is killed — the request is cut before it lands.
       *
       * That matters because hard tab-close is exactly how the production
       * cohort we are chasing left: four sessions ending 4–8 seconds in, with
       * the tab simply going hidden. This event will not see them.
       *
       * The signal that DOES catch them is `first_run_viewed` with no following
       * event in the session. `connection_deferred` is the narrower, cheaper
       * companion — in-app deferral only. It is deliberately not wired to
       * `pagehide` with a beacon: that would need a fetch endpoint outside the
       * Server Action allowlist this file is built on, which is a larger change
       * than the signal justifies.
       */
      recordLeadActionEvent('connection_deferred', { surface, channels: channelKey }).catch(() => {})
    }
  }, [surface, channelKey, channels.length])

  /** Call from every control that begins a connect flow, before navigating. */
  const markConnectIntent = useCallback(() => {
    engagedRef.current = true
  }, [])

  return { markConnectIntent }
}
