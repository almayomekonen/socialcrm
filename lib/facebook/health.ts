import { db } from '@/config/db'
import { GRAPH_BASE as GRAPH_API } from '@/lib/facebook/graph'
import { FACEBOOK_PAGE_REQUIRED_WEBHOOK_FIELDS } from '@/lib/facebook/pageWebhookFields'
import { resolvePageAccessToken } from '@/lib/facebook/pageToken'
import { fieldsForPageRow, subscribePageWebhooks } from '@/lib/facebook/pageSubscription'

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
}

function subscribedFieldsFromApps(apps: unknown): Set<string> {
  const fields = new Set<string>()
  if (!Array.isArray(apps)) return fields
  for (const app of apps) {
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

export async function checkFacebookConnection(pageId: string, pageAccessToken: string): Promise<FacebookHealthStatus> {
  const errors: string[] = []
  let tokenValid = false
  let permissionsOk = false
  let subscribed = false

  try {
    // Token in the Authorization header, never in the URL.
    const res = await fetchWithTimeout(`${GRAPH_API}/${pageId}/subscribed_apps`, {
      headers: { Authorization: `Bearer ${pageAccessToken}` },
    })
    const data = await res.json()
    if (res.ok && Array.isArray(data?.data)) {
      tokenValid = true
      console.log(`[FacebookHealth] Token valid [pageId=${pageId}]`)
    } else {
      errors.push('token_invalid')
      console.warn(`[FacebookHealth] Token invalid [pageId=${pageId}]:`, JSON.stringify(data).slice(0, 200))
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

  if (tokenValid) {
    permissionsOk = true

    // Check subscription — SocialCRM requires leadgen (Lead Ads) AND feed (comments).
    try {
      const res = await fetchWithTimeout(`${GRAPH_API}/${pageId}/subscribed_apps`, {
        headers: { Authorization: `Bearer ${pageAccessToken}` },
      })
      const data = await res.json()
      if (res.ok && Array.isArray(data?.data)) {
        const fields = subscribedFieldsFromApps(data.data)
        const hasLeadgen = fields.has('leadgen')
        const hasFeed = fields.has('feed')
        if (hasRequiredWebhookFields(fields)) {
          subscribed = true
          console.log(`[FacebookHealth] Subscription active [pageId=${pageId}]`)
        } else {
          errors.push('not_subscribed')
          if (!hasLeadgen) console.warn(`[FacebookHealth] No leadgen subscription [pageId=${pageId}]`)
          if (!hasFeed) console.warn(`[FacebookHealth] No feed subscription [pageId=${pageId}]`)
        }
      } else {
        errors.push('subscription_check_failed')
        console.warn(`[FacebookHealth] Subscription check failed [pageId=${pageId}]`)
      }
    } catch (err: any) {
      const isAbort = err?.name === 'AbortError'
      errors.push(isAbort ? 'subscription_check_timeout' : 'subscription_check_failed')
      if (isAbort) {
        console.warn(`[FacebookHealth] Subscription check timeout [pageId=${pageId}]`)
      } else {
        console.error(`[FacebookHealth] Subscription check error [pageId=${pageId}]:`, err?.message)
      }
    }
  }

  const needsReconnect = !tokenValid

  return { tokenValid, permissionsOk, subscribed, needsReconnect, errors }
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
  const status = await checkFacebookConnection(pageId, pageAccessToken)

  if (status.needsReconnect) {
    console.warn(`[FacebookRepair] Reconnect required [pageId=${pageId}] — errors: ${status.errors.join(', ')}`)
    return { repaired: false, needsReconnect: true, status }
  }

  if (!status.subscribed) {
    // The Page's OWN field set (leadgen,feed + Messenger fields when granted and
    // rolled out). Re-sending a constant here would silently unsubscribe Messenger.
    const fields = fieldsForPageRow(connection)
    console.log(`[FacebookRepair] Re-subscribing [pageId=${pageId}] fields=${fields}`)
    const sub = await subscribePageWebhooks(pageId, pageAccessToken, fields)
    if (sub.ok) {
      console.log(`[FacebookRepair] Re-subscribed successfully [pageId=${pageId}]`)
      status.subscribed = true
      status.errors = status.errors.filter((e) => e !== 'not_subscribed' && e !== 'subscription_check_failed')
      return { repaired: true, needsReconnect: false, status }
    }
    console.error(`[FacebookRepair] Re-subscription failed [pageId=${pageId}] status=${sub.status}`)
    return { repaired: false, needsReconnect: false, status }
  }

  console.log(`[FacebookRepair] Connection healthy — no repair needed [pageId=${pageId}]`)
  return { repaired: false, needsReconnect: false, status }
}
