import { cookies } from 'next/headers'
import { ATTRIBUTION_COOKIE, parseAttribution, type Attribution } from './attribution'

/**
 * Server-side reader for the attribution cookie written by
 * `<AttributionCapture/>` on the marketing shell.
 *
 * Kept OUT of `attribution.ts` deliberately. That module is pure — it is shared
 * with a client component and with unit tests, and importing `next/headers`
 * there would make it unusable in both. This file is the thin server edge:
 * read the cookie, hand the string to the pure parser, return the result.
 *
 * It is also why `actions/agencies.ts` does not grow a cookie-parsing branch.
 * That file sits at ~190 lines, inside the `architecture-rules.md` §7 growth
 * band, where the rule is that the next addition belongs somewhere else if it
 * is a different concern. Reading marketing attribution is a different concern
 * from creating an agency.
 *
 * Never throws. A missing, malformed, or truncated cookie yields `{}`, and the
 * registration event records exactly what it recorded before this existed.
 */
export async function readSignupAttribution(): Promise<Attribution> {
  try {
    const raw = (await cookies()).get(ATTRIBUTION_COOKIE)?.value
    return parseAttribution(raw) ?? {}
  } catch {
    return {}
  }
}
