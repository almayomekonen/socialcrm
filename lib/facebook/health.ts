import { db } from '@/config/db'
import { GRAPH_BASE as GRAPH_API } from '@/lib/facebook/graph'
import {
  FACEBOOK_PAGE_REQUIRED_WEBHOOK_FIELDS,
  FACEBOOK_PAGE_WEBHOOK_FIELDS,
  messengerCoreFields,
} from '@/lib/facebook/pageWebhookFields'
import { resolvePageAccessToken } from '@/lib/facebook/pageToken'
import { essentialFieldsForPageRow, fieldsForPageRow, subscribePageWebhooks } from '@/lib/facebook/pageSubscription'

const FETCH_TIMEOUT_MS = 6000

async function fetchWithTimeout(url: string, options?: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

export interface FacebookHealthStatus {
  tokenValid: boolean
  permissionsOk: boolean
  subscribed: boolean
  needsReconnect: boolean
  errors: string[]
  /**
   * Expected fields the Page is NOT subscribed to. Set only when the subscription
   * was actually read. `subscribed` keeps meaning "Lead Ads and comments are
   * subscribed"; a Messenger field missing here does not make a Page unhealthy.
   */
  missingFields?: string[]
  /**
   * The subset of `missingFields` whose absence actually BREAKS something —
   * leadgen/feed, and (when Messenger is due) `messages`/`message_echoes`.
   * Enhancement fields like `message_reactions` never appear here, so a Page
   * that Meta will not grant one of them is not reported to the rep as broken.
   */
  missingEssentialFields?: string[]
}

/**
 * Fields subscribed by OUR app. `/{page-id}/subscribed_apps` lists every app on
 * the Page, so another tool's `messages` or `leadgen` must never count as ours.
 * Without META_APP_ID (tests, misconfiguration) every app is counted, as before.
 */
function subscribedFieldsFromApps(apps: unknown): Set<string> {
  const fields = new Set<string>()
  if (!Array.isArray(apps)) return fields
  const ownAppId = process.env.META_APP_ID?.trim()
  if (ownAppId && apps.length > 0 && !apps.some((a) => String((a as { id?: unknown })?.id) === ownAppId)) {
    // Either our app really is not subscribed, or META_APP_ID is not this token's app.
    console.warn('[FacebookHealth] Page has subscribed apps, none of them META_APP_ID', { apps: apps.length })
  }
  for (const app of apps) {
    if (ownAppId && String((app as { id?: unknown })?.id) !== ownAppId) continue
    const list = (app as { subscribed_fields?: unknown })?.subscribed_fields
    if (!Array.isArray(list)) continue
    for (const f of list) {
      if (typeof f === 'string' && f) fields.add(f)
    }
  }
  return fields
}

function hasRequiredWebhookFields(fields: Set<string>): boolean {
  return FACEBOOK_PAGE_REQUIRED_WEBHOOK_FIELDS.every((f) => fields.has(f))
}

/** Throttling and transient Graph codes: nothing for the customer to fix, whatever the HTTP status. */
const TRANSIENT_GRAPH_CODES = new Set([1, 2, 4, 17, 32, 341, 368, 613])

/**
 * Why the token read failed, decided by Graph's error code first — Meta answers a
 * rate limit with HTTP 403 too. `token_invalid`: expired or revoked token (the
 * connection is dead). `permission_missing`: the token lacks a permission (a
 * reconnect fixes it; leads may still arrive). `token_check_failed`: anything else.
 */
function classifyTokenFailure(status: number, body: unknown): 'token_invalid' | 'permission_missing' | 'token_check_failed' {
  const error = (body as { error?: { code?: unknown; is_transient?: unknown } } | null)?.error
  const code = typeof error?.code === 'number' ? error.code : null
  if (error?.is_transient === true) return 'token_check_failed'
  if (code !== null) {
    if (TRANSIENT_GRAPH_CODES.has(code) || (code >= 80000 && code < 81000)) return 'token_check_failed'
    if (code === 190 || code === 102) return 'token_invalid'
    if (code === 10 || (code >= 200 && code < 300)) return 'permission_missing'
    return 'token_check_failed'
  }
  return status === 401 ? 'token_invalid' : 'token_check_failed'
}

export async function checkFacebookConnection(
  pageId: string,
  pageAccessToken: string,
  expectedFields: readonly string[] = FACEBOOK_PAGE_REQUIRED_WEBHOOK_FIELDS,
  essentialFields: readonly string[] = FACEBOOK_PAGE_REQUIRED_WEBHOOK_FIELDS,
): Promise<FacebookHealthStatus> {
  const errors: string[] = []
  let tokenValid = false
  let subscribed = false
  let missingFields: string[] | undefined
  let missingEssentialFields: string[] | undefined

  // ONE read answers both questions — does Meta accept the token, and what is the
  // Page subscribed to. It used to be the identical request sent twice, which
  // spent the Page's rate limit (shared with Lead Ads intake) for nothing.
  let apps: unknown[] | null = null
  try {
    // Token in the Authorization header, never in the URL.
    const res = await fetchWithTimeout(`${GRAPH_API}/${pageId}/subscribed_apps`, {
      headers: { Authorization: `Bearer ${pageAccessToken}` },
    })
    const data = await res.json().catch(() => null)
    if (res.ok && Array.isArray(data?.data)) {
      tokenValid = true
      apps = data.data
      console.log(`[FacebookHealth] Token valid [pageId=${pageId}]`)
    } else {
      // A rate limit or a Graph outage is not a dead token. `needsReconnect` below
      // is unchanged for all of them; the code lets callers tell them apart.
      const failure = classifyTokenFailure(res.status, data)
      errors.push(failure)
      console.warn(`[FacebookHealth] Token read failed (${failure}) [pageId=${pageId}]:`, JSON.stringify(data).slice(0, 200))
    }
  } catch (err: any) {
    const isAbort = err?.name === 'AbortError'
    errors.push(isAbort ? 'token_check_timeout' : 'token_check_failed')
    if (isAbort) {
      console.warn(`[FacebookHealth] Token check timeout [pageId=${pageId}]`)
    } else {
      console.error(`[FacebookHealth] Token check error [pageId=${pageId}]:`, err?.message)
    }
  }

  if (apps) {
    // SocialCRM requires leadgen (Lead Ads) AND feed (comments); expectedFields adds Messenger when due.
    const fields = subscribedFieldsFromApps(apps)
    missingFields = expectedFields.filter((f) => !fields.has(f))
    missingEssentialFields = essentialFields.filter((f) => !fields.has(f))
    if (hasRequiredWebhookFields(fields)) {
      subscribed = true
      console.log(`[FacebookHealth] Subscription active [pageId=${pageId}]`)
    } else {
      errors.push('not_subscribed')
      if (!fields.has('leadgen')) console.warn(`[FacebookHealth] No leadgen subscription [pageId=${pageId}]`)
      if (!fields.has('feed')) console.warn(`[FacebookHealth] No feed subscription [pageId=${pageId}]`)
    }
  }

  const needsReconnect = !tokenValid

  return { tokenValid, permissionsOk: tokenValid, subscribed, needsReconnect, errors, missingFields, missingEssentialFields }
}

export async function repairFacebookConnection(pageId: string): Promise<{
  repaired: boolean
  needsReconnect: boolean
  status: FacebookHealthStatus
}> {
  console.log(`[FacebookRepair] Starting [pageId=${pageId}]`)

  const connection = await db('facebook_pages').where({ page_id: pageId }).first()
  if (!connection) {
    console.error(`[FacebookRepair] No connection in DB [pageId=${pageId}]`)
    return {
      repaired: false,
      needsReconnect: true,
      status: {
        tokenValid: false,
        permissionsOk: false,
        subscribed: false,
        needsReconnect: true,
        errors: ['no_db_connection'],
      },
    }
  }

  const pageAccessToken = resolvePageAccessToken(connection.page_access_token)
  // The Page's OWN field set (leadgen,feed + Messenger fields when granted and
  // rolled out). Re-sending a constant here would silently unsubscribe Messenger,
  // and checking only leadgen,feed would never subscribe it: turning the
  // Messenger rollout on does not touch a Page by itself (incident 2026-09-14).
  const fields = fieldsForPageRow(connection)
  const essential = essentialFieldsForPageRow(connection)
  const status = await checkFacebookConnection(pageId, pageAccessToken, fields.split(','), essential.split(','))

  if (status.needsReconnect) {
    console.warn(`[FacebookRepair] Reconnect required [pageId=${pageId}] — errors: ${status.errors.join(', ')}`)
    return { repaired: false, needsReconnect: true, status }
  }

  if (!status.subscribed || (status.missingFields?.length ?? 0) > 0) {
    console.log(`[FacebookRepair] Re-subscribing [pageId=${pageId}] fields=${fields} missing=${status.missingFields?.join(',')}`)
    const sub = await subscribePageWebhooks(pageId, pageAccessToken, fields)
    if (sub.ok) {
      console.log(`[FacebookRepair] Re-subscribed successfully [pageId=${pageId}]`)
      status.subscribed = true
      status.missingFields = []
      status.errors = status.errors.filter((e) => e !== 'not_subscribed')
      return { repaired: true, needsReconnect: false, status }
    }
    console.error(`[FacebookRepair] Re-subscription failed [pageId=${pageId}] status=${sub.status}`)
    // TIERED FALLBACK. Meta replaces the whole set and rejects the whole call for
    // one bad name, so back off one tier at a time rather than all the way:
    //   full set → leadgen,feed + core Messenger → leadgen,feed
    // A refused enhancement (say `message_reactions`) then costs that
    // enhancement, not the rep's ability to receive messages, and never Lead Ads.
    // Only for a refusal (4xx): a network error or a Graph outage would otherwise
    // drop fields the Page may still have.
    const refused = sub.status >= 400 && sub.status < 500
    const core = messengerCoreFields()
    if (refused && fields !== core && core !== FACEBOOK_PAGE_WEBHOOK_FIELDS) {
      const mid = await subscribePageWebhooks(pageId, pageAccessToken, core)
      if (mid.ok) {
        console.warn(`[FacebookRepair] Enhancement fields refused; subscribed ${core} [pageId=${pageId}]`)
        status.subscribed = true
        status.missingFields = fields.split(',').filter((f) => !core.split(',').includes(f))
        status.missingEssentialFields = []
        status.errors = status.errors.filter((e) => e !== 'not_subscribed')
        return { repaired: true, needsReconnect: false, status }
      }
    }
    if (!status.subscribed && fields !== FACEBOOK_PAGE_WEBHOOK_FIELDS && refused) {
      const base = await subscribePageWebhooks(pageId, pageAccessToken, FACEBOOK_PAGE_WEBHOOK_FIELDS)
      if (base.ok) {
        console.warn(`[FacebookRepair] Restored ${FACEBOOK_PAGE_WEBHOOK_FIELDS} only [pageId=${pageId}]`)
        status.subscribed = true
        const restored = FACEBOOK_PAGE_REQUIRED_WEBHOOK_FIELDS as readonly string[]
        status.missingFields = fields.split(',').filter((f) => !restored.includes(f))
        // leadgen/feed are subscribed again as of this call, so they are no
        // longer missing; what remains essential-but-absent is Messenger's core.
        status.missingEssentialFields = essential.split(',').filter((f) => !restored.includes(f))
        status.errors = status.errors.filter((e) => e !== 'not_subscribed')
        return { repaired: true, needsReconnect: false, status }
      }
    }
    return { repaired: false, needsReconnect: false, status }
  }

  console.log(`[FacebookRepair] Connection healthy — no repair needed [pageId=${pageId}]`)
  return { repaired: false, needsReconnect: false, status }
}
