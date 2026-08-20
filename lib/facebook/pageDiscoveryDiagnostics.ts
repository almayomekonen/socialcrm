import { GRAPH_BASE } from '@/lib/facebook/graph'

/**
 * SAFE diagnostics for the Facebook Page-discovery step.
 *
 * WHY THIS EXISTS
 * Production showed 33 `stage=discover` failures across four agencies, every
 * one of them reported as `NO_PAGES` — a verdict the callback inferred from
 * `/me/permissions` alone. That inference cannot separate three very different
 * root causes:
 *
 *   1. the token grants ZERO Pages      (granular_scopes.target_ids = [])
 *   2. the token grants Pages, yet /me/accounts still returns an empty list
 *   3. Meta returned a non-2xx error that was relabelled as "no Pages"
 *
 * This module produces the minimum evidence needed to tell them apart, and —
 * since that evidence arrived and answered the question — it also hands the
 * authorised Page ids to discovery. Case 2 turned out to be real in production
 * (`grantedPageIdCount: 1` with `returnedPageCount: 0`), so `grantedPageIds` is
 * now the PRIMARY discovery source; see `discoverPages.ts`. It still never
 * gates the connection and never throws.
 *
 * SAFETY (binding): nothing returned here may carry an access token, app
 * secret, client secret, OAuth code, or raw Business id. `grantedPageIds` is
 * the single field carrying raw asset ids: it exists so discovery can resolve
 * Pages directly, and it MUST NEVER be logged or written to analytics — the
 * callback selects diagnostic fields one by one, and that field is not among
 * them. The Facebook user id leaves only as a truncated hash — enough to
 * correlate one customer's repeated attempts, not enough to identify the
 * account. `redactSecrets()` is applied to every provider-authored string
 * before it can reach a log line or the analytics table.
 */

/** Truncated SHA-256: a correlation key, deliberately not a reversible id. */
const FB_USER_HASH_LEN = 12
/** Provider-authored text is truncated before it is ever stored. */
const MAX_MESSAGE_LEN = 300
/** debug_token is a diagnostic; it must never stall a user's connection. */
const DEBUG_TOKEN_TIMEOUT_MS = 4000
const PAGES_SCOPE = 'pages_show_list'

type GranularScope = { scope?: string; target_ids?: string[] }

export type FbTokenDiagnostics = {
  /** false = diagnostics unavailable. Never a failure signal for the flow. */
  debugTokenOk: boolean
  /** SHA-256 of the Facebook user id, first 12 hex chars. Correlation only. */
  fbUserIdHash: string | null
  /** Permission NAMES carried by the token. Names only — never asset ids. */
  scopes: string[]
  /**
   * Count of Page ids in `granular_scopes` for `pages_show_list`:
   *   0     → the scope was granted but scoped to ZERO Pages (suspected cause)
   *   > 0   → Pages WERE granted; an empty /me/accounts means something else
   *   null  → no granular entry for the scope, or debug_token was unavailable
   * `granularPagesEntryPresent` disambiguates the null.
   */
  grantedPageIdCount: number | null
  /**
   * The Page ids in `granular_scopes` for `pages_show_list` — the exact Pages
   * the user approved in the OAuth dialog. Consumed by `discoverPages.ts` to
   * resolve each Page directly, which is what makes discovery work for Pages
   * the `/me/accounts` edge cannot see. NEVER log or store these (see SAFETY).
   */
  grantedPageIds: string[]
  /** Whether granular_scopes carried a pages_show_list entry at all. */
  granularPagesEntryPresent: boolean
  tokenIsValid: boolean | null
}

export type MetaErrorDetails = {
  metaErrorCode: number | null
  metaErrorSubcode: number | null
  metaErrorType: string | null
  metaErrorMessage: string | null
  fbtraceId: string | null
}

function unavailable(): FbTokenDiagnostics {
  return {
    debugTokenOk: false,
    fbUserIdHash: null,
    scopes: [],
    grantedPageIdCount: null,
    grantedPageIds: [],
    granularPagesEntryPresent: false,
    tokenIsValid: null,
  }
}

/**
 * Strip anything credential-shaped from provider-authored text.
 *
 * Meta's own error messages do not normally echo credentials, but they are not
 * a contract we control — and this text is written to logs and to a durable
 * analytics row. Redaction is applied unconditionally rather than trusting the
 * provider to stay well-behaved.
 */
export function redactSecrets(input: string): string {
  return input
    .replace(/\b(access_token|client_secret|app_secret|appsecret_proof|code)=[^&\s"']+/gi, '$1=<redacted>')
    .replace(/\bEA[A-Za-z0-9_-]{20,}\b/g, '<redacted-token>')
}

const asNumber = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const asString = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null)

/**
 * Pull the safe fields out of a Meta error body. Total-failure tolerant: a
 * non-JSON body (proxy/HTML error page) still yields a redacted, truncated
 * message rather than nothing, because "what did Meta actually say" is the
 * whole point of the call site.
 */
export function parseMetaError(bodyText: string): MetaErrorDetails {
  const empty: MetaErrorDetails = {
    metaErrorCode: null,
    metaErrorSubcode: null,
    metaErrorType: null,
    metaErrorMessage: null,
    fbtraceId: null,
  }
  const safeText = (v: string) => redactSecrets(v).slice(0, MAX_MESSAGE_LEN) || null
  try {
    const error = (JSON.parse(bodyText) as { error?: Record<string, unknown> } | null)?.error
    if (!error || typeof error !== 'object') return { ...empty, metaErrorMessage: safeText(bodyText) }
    const message = asString(error.message)
    return {
      metaErrorCode: asNumber(error.code),
      metaErrorSubcode: asNumber(error.error_subcode),
      metaErrorType: asString(error.type),
      metaErrorMessage: message ? safeText(message) : null,
      fbtraceId: asString(error.fbtrace_id),
    }
  } catch {
    return { ...empty, metaErrorMessage: safeText(bodyText) }
  }
}

/**
 * Truncated SHA-256 of a Meta asset id (user id, Page id).
 *
 * A correlation key, deliberately not reversible: enough to tell "the same
 * Page failed twice" from "two different Pages failed", never enough to
 * identify the asset. This is what lets Page-level diagnostics be logged at
 * all — raw Page ids may not be (see SAFETY above).
 */
export async function hashAssetId(assetId: string): Promise<string | null> {
  try {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(assetId))
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, FB_USER_HASH_LEN)
  } catch {
    return null
  }
}

/** Truncated SHA-256 of the Facebook user id. Never the id itself. */
export const hashFbUserId = hashAssetId

/**
 * Inspect the freshly-exchanged User Access Token via debug_token.
 *
 * Mirrors the technique already proven in `lib/whatsapp/resolveWaba.ts`. Every
 * failure path degrades to `unavailable()` — a missing diagnostic must never
 * turn a working connection into a broken one.
 */
export async function inspectFacebookToken(
  token: string,
  appId: string | undefined = process.env.META_APP_ID,
  appSecret: string | undefined = process.env.META_APP_SECRET,
): Promise<FbTokenDiagnostics> {
  if (!token || !appId || !appSecret) return unavailable()
  try {
    const appToken = `${appId}|${appSecret}`
    const res = await fetch(
      `${GRAPH_BASE}/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(appToken)}`,
      { signal: AbortSignal.timeout(DEBUG_TOKEN_TIMEOUT_MS) },
    )
    if (!res.ok) return unavailable()
    const data = ((await res.json()) as { data?: Record<string, unknown> } | null)?.data
    if (!data) return unavailable()

    const granular: GranularScope[] = Array.isArray(data.granular_scopes) ? (data.granular_scopes as GranularScope[]) : []
    const pagesEntry = granular.find((g) => g?.scope === PAGES_SCOPE)
    const targetIds = Array.isArray(pagesEntry?.target_ids) ? pagesEntry.target_ids : null
    const userId = data.user_id != null ? String(data.user_id) : null

    return {
      debugTokenOk: true,
      fbUserIdHash: userId ? await hashFbUserId(userId) : null,
      scopes: Array.isArray(data.scopes) ? (data.scopes as unknown[]).filter((s): s is string => typeof s === 'string') : [],
      grantedPageIdCount: pagesEntry ? (targetIds ? targetIds.length : null) : null,
      grantedPageIds: targetIds ? targetIds.filter((id): id is string => typeof id === 'string' && id.length > 0) : [],
      granularPagesEntryPresent: Boolean(pagesEntry),
      tokenIsValid: typeof data.is_valid === 'boolean' ? data.is_valid : null,
    }
  } catch {
    return unavailable()
  }
}
