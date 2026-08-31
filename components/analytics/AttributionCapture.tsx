'use client'

import { useEffect } from 'react'
import {
  ATTRIBUTION_COOKIE,
  ATTRIBUTION_MAX_AGE_S,
  parseAttribution,
  readAttributionFromUrl,
  serializeAttribution,
  shouldOverwriteAttribution,
} from '@/lib/activation/attribution'

/**
 * Records WHERE a visitor came from, so the signup they may later complete can
 * be attributed to a campaign.
 *
 * Mounted on the marketing shell only. It writes one cookie and does nothing
 * else: no network request, no analytics call, no user-visible behaviour. The
 * cookie is read once, server-side, in `addAgency()` and merged into
 * `registration_completed.props`.
 *
 * WHY A COOKIE AND NOT THE URL. The registration flow already proves the URL
 * cannot carry this: `redirect()` drops the query string, and the (app) layout
 * swaps `{children}` for the teaser while the trial is NEVER_STARTED. A cookie
 * survives both. This is the same mechanism `scrm_reg` already uses, with an
 * acquisition-length window instead of a handoff-length one.
 *
 * `httpOnly` is impossible here (a client component is the writer) and is not
 * needed — the value is marketing attribution the visitor themselves supplied
 * in their own URL. It is never a credential and never identifies a person.
 *
 * Everything is wrapped: a browser with cookies disabled, a private window, or
 * a hostile referrer must cost us an attribution, never a landing page render.
 */
export default function AttributionCapture() {
  useEffect(() => {
    try {
      const incoming = readAttributionFromUrl(
        window.location.search,
        document.referrer,
        window.location.hostname,
      )
      // Nothing to record — an organic visit with no referrer. Leave whatever
      // is already stored completely alone.
      if (Object.keys(incoming).length === 0) return

      const existing = parseAttribution(readCookie(ATTRIBUTION_COOKIE))
      if (!shouldOverwriteAttribution(existing, incoming)) return

      const value = encodeURIComponent(serializeAttribution(incoming))
      const secure = window.location.protocol === 'https:' ? '; Secure' : ''
      document.cookie = `${ATTRIBUTION_COOKIE}=${value}; Max-Age=${ATTRIBUTION_MAX_AGE_S}; Path=/; SameSite=Lax${secure}`
    } catch {
      // Attribution is measurement. It must never break a marketing page.
    }
  }, [])

  return null
}

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}
