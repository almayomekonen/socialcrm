import { hashAssetId, parseMetaError, type MetaErrorDetails } from '@/lib/facebook/pageDiscoveryDiagnostics'

/**
 * Facebook Page discovery.
 *
 * WHY THIS EXISTS
 * `/me/accounts` enumerates the user→accounts edge (classic Page roles).
 * Granular consent, however, authorises a SPECIFIC Page id, recorded on the
 * token as `granular_scopes[pages_show_list].target_ids`. When the Page lives
 * in the New Pages Experience or is owned by a Business Portfolio, the consent
 * is recorded while the user→accounts edge still answers `200 {"data":[]}`.
 * Production evidence: `grantedPageIdCount: 1` alongside `returnedPageCount: 0`
 * on a valid token with `pages_show_list` granted.
 *
 * Commit 7d601b1b replaced the granular-target_ids implementation with
 * `/me/accounts` and reintroduced exactly that failure. This module restores
 * granular target_ids as the PRIMARY source and keeps `/me/accounts` as the
 * fallback, so every account that connects successfully today is unaffected.
 *
 * SAFETY (binding): Page ids and Page access tokens flow through the return
 * value to the connection flow and MUST NEVER reach a log line or an analytics
 * row. The only values this module exposes for diagnostics are counts and a
 * source label — see `PageDiscoveryDiagnostics`.
 *
 * The Graph version is pinned to v19.0 to match every other call in the OAuth
 * callback. Changing it is a separate decision, deliberately not made here.
 */

const GRAPH_VERSION_PINNED = 'v19.0'
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION_PINNED}`
/** A Page fetch is on the user's critical path; it must never hang the flow. */
const PAGE_FETCH_TIMEOUT_MS = 5000
/**
 * Two field sets, tried in order.
 *
 * `name` is Page PUBLIC METADATA: reading it off the Page node requires
 * `pages_read_engagement` (or the Page Public Content/Metadata Access
 * features). Production 2026-08-20, Meta verbatim:
 *   code 100 OAuthException — "This endpoint requires the
 *   'pages_read_engagement' permission or the 'Page Public Content Access'
 *   feature or the 'Page Public Metadata Access' feature."
 *
 * `access_token` is NOT public metadata — it is an owned-asset field, granted
 * by `pages_show_list`, which we already hold. So when the full read is
 * refused we retry without `name`: a Page token with a placeholder name still
 * connects and still receives leadgen webhooks, whereas no token at all leaves
 * the customer stuck. The Page name is cosmetic; the token is the integration.
 */
const PAGE_FIELDS_FULL = 'id,name,access_token'
const PAGE_FIELDS_MINIMAL = 'id,access_token'
/** Bound the diagnostic: a pathological grant must not write an unbounded row. */
const MAX_ATTEMPTS_RECORDED = 5

export type DiscoveredPage = { id: string; name: string; access_token: string }

/**
 * Why one authorised Page id did or did not resolve.
 *
 * Exists because `fetchPageById` previously returned a bare `null` for every
 * failure mode — HTTP error, missing field, thrown request — so production
 * could see `granularResolvedCount: 0` without being able to say WHY. Every
 * field here is safe to log: the Page id appears only as a truncated hash, and
 * provider text goes through `parseMetaError` (redacted + truncated).
 */
export type PageFetchAttempt = {
  pageIdHash: string | null
  httpStatus: number | null
  hasId: boolean
  hasName: boolean
  hasAccessToken: boolean
  graphVersion: string
  fieldsRequested: string
  /** Set when the request itself never completed (timeout, DNS, abort). */
  transportError: string | null
} & MetaErrorDetails

export type PageDiscoveryDiagnostics = {
  /** Which source produced the Pages. 'none' = neither source returned any. */
  discoverySource: 'granular' | 'accounts' | 'none'
  /** How many Page ids granular consent offered us. */
  granularAttemptedCount: number
  /** How many of those resolved to a usable Page + Page access token. */
  granularResolvedCount: number
  /** `/me/accounts` HTTP status, or null when the fallback was never needed. */
  httpStatus: number | null
  /** Whether `/me/accounts` carried a `data` array. Null when never called. */
  dataKeyPresent: boolean | null
  /** Final usable Page count, whichever source produced it. */
  returnedPageCount: number
  /** Per-Page outcome of the granular attempt. Safe to log; see PageFetchAttempt. */
  granularAttempts: PageFetchAttempt[]
}

export type PageDiscovery = {
  pages: DiscoveredPage[]
  diagnostics: PageDiscoveryDiagnostics
  /** Set ONLY when the `/me/accounts` fallback returned a non-2xx. */
  providerError: MetaErrorDetails | null
}

/**
 * Resolve one authorised Page id to a Page + Page access token.
 *
 * Total-failure tolerant: a Page that cannot be resolved returns null so the
 * remaining Pages — and the `/me/accounts` fallback — still get their chance.
 */
async function requestPage(
  pageId: string,
  userToken: string,
  fields: string,
): Promise<{ page: DiscoveredPage | null; attempt: PageFetchAttempt }> {
  const noError: MetaErrorDetails = {
    metaErrorCode: null,
    metaErrorSubcode: null,
    metaErrorType: null,
    metaErrorMessage: null,
    fbtraceId: null,
  }
  const attempt: PageFetchAttempt = {
    pageIdHash: await hashAssetId(pageId),
    httpStatus: null,
    hasId: false,
    hasName: false,
    hasAccessToken: false,
    graphVersion: GRAPH_VERSION_PINNED,
    fieldsRequested: fields,
    transportError: null,
    ...noError,
  }

  try {
    const res = await fetch(
      `${GRAPH}/${encodeURIComponent(pageId)}?fields=${fields}&access_token=${encodeURIComponent(userToken)}`,
      { signal: AbortSignal.timeout(PAGE_FETCH_TIMEOUT_MS) },
    )
    attempt.httpStatus = res.status

    // Read as text once: it has to serve both the error parser and the shape
    // check, and a Response body can only be consumed a single time.
    const bodyText = await res.text()
    let body: { id?: unknown; name?: unknown; access_token?: unknown; error?: unknown } | null = null
    try {
      body = JSON.parse(bodyText)
    } catch {
      // Non-JSON (proxy/HTML error page) — parseMetaError still yields a
      // redacted, truncated message, which is the whole point here.
    }

    // Meta can answer 200 with an error envelope, so check the body either way.
    if (!res.ok || (body && body.error)) Object.assign(attempt, parseMetaError(bodyText))

    attempt.hasId = typeof body?.id === 'string' && body.id.length > 0
    attempt.hasName = typeof body?.name === 'string' && body.name.length > 0
    attempt.hasAccessToken = typeof body?.access_token === 'string' && body.access_token.length > 0

    if (!res.ok) return { page: null, attempt }
    // Without a Page access token the Page is useless downstream: the connect
    // route cannot subscribe it to leadgen webhooks.
    if (!attempt.hasId || !attempt.hasAccessToken) return { page: null, attempt }

    const id = body!.id as string
    const name = attempt.hasName ? (body!.name as string) : id
    return { page: { id, name, access_token: body!.access_token as string }, attempt }
  } catch (err) {
    attempt.transportError = err instanceof Error ? err.name : 'UnknownError'
    return { page: null, attempt }
  }
}

/**
 * Resolve one authorised Page id to a Page + Page access token.
 *
 * Tries the full field set first so a normally-permissioned app keeps getting
 * real Page names. Only when Meta refuses the read does it retry without
 * `name` — see PAGE_FIELDS_FULL/MINIMAL. Both attempts are recorded so the
 * analytics row shows exactly which one Meta accepted.
 */
async function fetchPageById(
  pageId: string,
  userToken: string,
): Promise<{ page: DiscoveredPage | null; attempts: PageFetchAttempt[] }> {
  const full = await requestPage(pageId, userToken, PAGE_FIELDS_FULL)
  if (full.page) return { page: full.page, attempts: [full.attempt] }

  // Retry only when Meta refused the READ. A transport failure or a genuine
  // "no token for this user" answer is not made better by asking for less.
  const refused = full.attempt.metaErrorCode !== null && full.attempt.httpStatus !== null
  if (!refused) return { page: null, attempts: [full.attempt] }

  const minimal = await requestPage(pageId, userToken, PAGE_FIELDS_MINIMAL)
  return { page: minimal.page, attempts: [full.attempt, minimal.attempt] }
}

/** Shape `/me/accounts` entries exactly as the pre-existing implementation did. */
function mapAccountsEntries(data: unknown[]): DiscoveredPage[] {
  return (data as { id: string; name: string; access_token: string }[]).map((p) => ({
    id: p.id,
    name: p.name,
    access_token: p.access_token,
  }))
}

/**
 * Discover the Pages a user has authorised.
 *
 * Order is deliberate:
 *   1. granular `target_ids` → direct Page fetch  (works for NPE / Business-owned)
 *   2. `/me/accounts`                             (the pre-existing source, unchanged)
 *
 * Step 2 runs whenever step 1 yields nothing — whether granular ids were absent
 * or every direct fetch failed.
 */
export async function discoverFacebookPages(userToken: string, grantedPageIds: string[]): Promise<PageDiscovery> {
  const granularAttemptedCount = grantedPageIds.length

  const results = granularAttemptedCount > 0 ? await Promise.all(grantedPageIds.map((id) => fetchPageById(id, userToken))) : []
  const granularPages = results.map((r) => r.page).filter((p): p is DiscoveredPage => p !== null)
  const granularAttempts = results.flatMap((r) => r.attempts).slice(0, MAX_ATTEMPTS_RECORDED)

  if (granularPages.length > 0) {
    return {
      pages: granularPages,
      providerError: null,
      diagnostics: {
        discoverySource: 'granular',
        granularAttemptedCount,
        granularResolvedCount: granularPages.length,
        httpStatus: null,
        dataKeyPresent: null,
        returnedPageCount: granularPages.length,
        granularAttempts,
      },
    }
  }

  const base = { granularAttemptedCount, granularResolvedCount: 0, granularAttempts }
  const res = await fetch(`${GRAPH}/me/accounts?access_token=${userToken}`)

  if (!res.ok) {
    // A non-2xx from Meta is a PROVIDER error, never "this account has no Page".
    return {
      pages: [],
      providerError: parseMetaError(await res.text()),
      diagnostics: {
        ...base,
        discoverySource: 'none',
        httpStatus: res.status,
        dataKeyPresent: null,
        returnedPageCount: 0,
      },
    }
  }

  const body = await res.json()
  // A 200 whose body carries no `data` key at all is a different state from a
  // 200 with an empty array; both used to collapse into "no pages".
  const dataKeyPresent = Array.isArray(body?.data)
  const pages = mapAccountsEntries(dataKeyPresent ? body.data : [])

  return {
    pages,
    providerError: null,
    diagnostics: {
      ...base,
      discoverySource: pages.length > 0 ? 'accounts' : 'none',
      httpStatus: res.status,
      dataKeyPresent,
      returnedPageCount: pages.length,
    },
  }
}
