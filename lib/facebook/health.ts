import { db } from '@/config/db'

const GRAPH_API = 'https://graph.facebook.com/v19.0'

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

export async function checkFacebookConnection(pageId: string, pageAccessToken: string): Promise<FacebookHealthStatus> {
  const errors: string[] = []
  let tokenValid = false
  let permissionsOk = false
  let subscribed = false

  // 1. Token validity
  try {
    const res = await fetchWithTimeout(`${GRAPH_API}/me?access_token=${pageAccessToken}`)
    const data = await res.json()
    if (res.ok && data?.id) {
      tokenValid = true
      console.log(`[FacebookHealth] Token valid [pageId=${pageId}]`)
    } else {
      errors.push('token_invalid')
      console.warn(`[FacebookHealth] Token invalid [pageId=${pageId}]:`, JSON.stringify(data).slice(0, 200))
    }
  } catch (err: any) {
    errors.push(err?.name === 'AbortError' ? 'token_check_timeout' : 'token_check_failed')
    console.error(`[FacebookHealth] Token check error [pageId=${pageId}]:`, err?.message)
  }

  if (tokenValid) {
    permissionsOk = true

    // Check subscription
    try {
      const res = await fetchWithTimeout(`${GRAPH_API}/${pageId}/subscribed_apps?access_token=${pageAccessToken}`)
      const data = await res.json()
      if (res.ok && Array.isArray(data?.data)) {
        const hasLeadgen = data.data.some(
          (app: any) => Array.isArray(app.subscribed_fields) && app.subscribed_fields.includes('leadgen'),
        )
        if (hasLeadgen) {
          subscribed = true
          console.log(`[FacebookHealth] Subscription active [pageId=${pageId}]`)
        } else {
          errors.push('not_subscribed')
          console.warn(`[FacebookHealth] No leadgen subscription [pageId=${pageId}]`)
        }
      } else {
        errors.push('subscription_check_failed')
        console.warn(`[FacebookHealth] Subscription check failed [pageId=${pageId}]`)
      }
    } catch (err: any) {
      errors.push(err?.name === 'AbortError' ? 'subscription_check_timeout' : 'subscription_check_failed')
      console.error(`[FacebookHealth] Subscription check error [pageId=${pageId}]:`, err?.message)
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

  const status = await checkFacebookConnection(pageId, connection.page_access_token)

  if (status.needsReconnect) {
    console.warn(`[FacebookRepair] Reconnect required [pageId=${pageId}] — errors: ${status.errors.join(', ')}`)
    return { repaired: false, needsReconnect: true, status }
  }

  // Token and permissions are OK — attempt to repair missing subscription
  if (!status.subscribed) {
    console.log(`[FacebookRepair] Re-subscribing [pageId=${pageId}]`)
    try {
      const res = await fetch(`${GRAPH_API}/${pageId}/subscribed_apps`, {
        method: 'POST',
        body: new URLSearchParams({
          access_token: connection.page_access_token,
          subscribed_fields: 'leadgen',
        }),
      })
      const data = await res.json()
      if (res.ok && data?.success) {
        console.log(`[FacebookRepair] Re-subscribed successfully [pageId=${pageId}]`)
        status.subscribed = true
        status.errors = status.errors.filter((e) => e !== 'not_subscribed' && e !== 'subscription_check_failed')
        return { repaired: true, needsReconnect: false, status }
      } else {
        console.error(`[FacebookRepair] Re-subscription failed [pageId=${pageId}]:`, JSON.stringify(data).slice(0, 200))
      }
    } catch (err) {
      console.error(`[FacebookRepair] Re-subscription threw [pageId=${pageId}]:`, err)
    }
    return { repaired: false, needsReconnect: false, status }
  }

  console.log(`[FacebookRepair] Connection healthy — no repair needed [pageId=${pageId}]`)
  return { repaired: false, needsReconnect: false, status }
}
