import { parseMetaError, type MetaErrorDetails } from '@/lib/facebook/pageDiscoveryDiagnostics'

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

const GRAPH = 'https://graph.facebook.com/v19.0'
/** A Page fetch is on the user's critical path; it must never hang the flow. */
const PAGE_FETCH_TIMEOUT_MS = 5000

export type DiscoveredPage = { id: string; name: string; access_token: string }

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
async function fetchPageById(pageId: string, userToken: string): Promise<DiscoveredPage | null> {
  try {
    const res = await fetch(
      `${GRAPH}/${encodeURIComponent(pageId)}?fields=id,name,access_token&access_token=${encodeURIComponent(userToken)}`,
      { signal: AbortSignal.timeout(PAGE_FETCH_TIMEOUT_MS) },
    )
    if (!res.ok) return null
    const page = (await res.json()) as { id?: unknown; name?: unknown; access_token?: unknown } | null
    // Without a Page access token the Page is useless downstream: the connect
    // route cannot subscribe it to leadgen webhooks.
    if (typeof page?.id !== 'string' || typeof page.access_token !== 'string' || !page.access_token) return null
    const name = typeof page.name === 'string' && page.name.length > 0 ? page.name : page.id
    return { id: page.id, name, access_token: page.access_token }
  } catch {
    return null
  }
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

  const granularPages =
    granularAttemptedCount > 0
      ? (await Promise.all(grantedPageIds.map((id) => fetchPageById(id, userToken)))).filter(
          (p): p is DiscoveredPage => p !== null,
        )
      : []

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
      },
    }
  }

  const base = { granularAttemptedCount, granularResolvedCount: 0 }
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
