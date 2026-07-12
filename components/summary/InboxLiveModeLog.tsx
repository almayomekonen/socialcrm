'use client'

import { useEffect } from 'react'

const SESSION_KEY = '__inbox_live_mode_logged__'

/**
 * Once-per-session observability for inbox live mode (Wave A1).
 * Logs `{ delta, refreshMs }` with no PII.
 */
export default function InboxLiveModeLog({
  deltaSyncEnabled,
  refreshMs,
}: {
  deltaSyncEnabled: boolean
  refreshMs: number | null
}) {
  useEffect(() => {
    try {
      if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(SESSION_KEY)) return
      if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(SESSION_KEY, '1')
    } catch {
      // sessionStorage may be unavailable; still log once this mount.
    }
    console.info('inbox.liveMode', { delta: deltaSyncEnabled, refreshMs })
  }, [deltaSyncEnabled, refreshMs])

  return null
}
