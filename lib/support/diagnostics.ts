import { parseUserAgent } from '@/lib/parseUserAgent'

/**
 * What SocialCRM was doing when the problem happened — captured on the SERVER at
 * submit time, so the customer never has to describe their environment.
 *
 * `clientRoute` is the ONE client-supplied value here, and it is INFORMATIONAL
 * ONLY: untrusted display metadata, stored as text, rendered as text, never
 * parsed. It must never influence authorization, agency resolution, context
 * resolution, integration lookup, category, or ownership.
 *
 * That is guaranteed by DATA FLOW rather than by discipline: buildDiagnostics()
 * runs AFTER context resolution, so a resolver cannot observe it — it does not
 * exist yet while resolvers run — and no resolver signature accepts diagnostics.
 *
 * No IP address. db/loginActivity.ts already holds recent IPs if an
 * investigation ever needs one, and duplicating it into every support request is
 * data the support job does not require.
 */

export type SupportDiagnostics = {
  agencyId: number
  userId: number
  plan: string | null
  trialStatus: string | null
  browser: string
  os: string
  appVersion: string | null
  clientRoute: string
  submittedAt: string
}

const MAX_ROUTE_CHARS = 200

/** Pathname only, capped, control characters removed. Never a URL, never a query. */
export function sanitiseClientRoute(raw: string | null | undefined): string {
  if (typeof raw !== 'string') return ''
  // Strip C0 and C1 control characters so a route can never carry an ANSI
  // escape into a log line or a terminal.
  // eslint-disable-next-line no-control-regex
  const stripped = raw.replace(/[\u0000-\u001F\u007F]/g, '').trim()
  if (!stripped.startsWith('/')) return ''
  // `//evil.example.com` is a protocol-relative URL, not a local path.
  if (stripped.startsWith('//')) return ''
  if (stripped.includes('..')) return ''
  // A real pathname contains no whitespace, so anything from the first space
  // onwards is not part of it. This is what finishes the job on an ANSI escape:
  // removing the ESC byte alone would leave "[31m" sitting in the route as
  // ordinary text, which is exactly the kind of residue that later gets echoed
  // somewhere it should not be.
  const pathname = stripped.split(/[\s?#]/)[0]
  return pathname.slice(0, MAX_ROUTE_CHARS)
}

export function buildDiagnostics(input: {
  agencyId: number
  userId: number
  plan: string | null
  trialStatus: string | null
  userAgent: string | null
  appVersion: string | null
  clientRoute: string | null
  now: Date
}): SupportDiagnostics {
  const { browser, os } = parseUserAgent(input.userAgent)
  return {
    agencyId: input.agencyId,
    userId: input.userId,
    plan: input.plan ?? null,
    trialStatus: input.trialStatus ?? null,
    browser,
    os,
    appVersion: input.appVersion ?? null,
    clientRoute: sanitiseClientRoute(input.clientRoute),
    submittedAt: input.now.toISOString(),
  }
}
