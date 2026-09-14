import { NextResponse } from 'next/server'
import { requireActiveAgencyUser, statusFor } from '@/lib/api/routeAuth'
import { db } from '@/config/db'
import { checkFacebookConnection } from '@/lib/facebook/health'
import { resolvePageAccessToken } from '@/lib/facebook/pageToken'
import { markFacebookDisconnectedAndNotify } from '@/lib/facebook/integrationNotifications'
import { getAgencyProductAccess } from '@/lib/access/productAccess'

const HEALTH_CACHE_MS = 30 * 60 * 1000 // 30 minutes

export async function GET() {
  // Reads and health-updates the caller's OWN connection, so no role test — but
  // `getUser()` never consulted `suspended`, and this writes `health_status`.
  const auth = await requireActiveAgencyUser()
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: statusFor(auth.reason) })
  }
  const user = auth.user
  // Returns lastLeadAt (CRM-derived) — gate on product access.
  if (user.agencyId && !(await getAgencyProductAccess(user.agencyId)).hasAccess) {
    return NextResponse.json({ error: 'product-access-required' }, { status: 403 })
  }

  const connection = await db('facebook_pages').where({ user_id: user.id }).first()
  if (!connection) {
    return NextResponse.json({ connected: false })
  }

  const isKnownExpired = connection.health_status === 'token_expired'

  const checkedAt = connection.health_checked_at ? new Date(connection.health_checked_at).getTime() : 0
  const isCacheFresh = Date.now() - checkedAt < HEALTH_CACHE_MS

  let health: Awaited<ReturnType<typeof checkFacebookConnection>>

  if (isKnownExpired || isCacheFresh) {
    health = {
      tokenValid: connection.health_status === 'healthy',
      permissionsOk: connection.health_status === 'healthy',
      subscribed: connection.health_status === 'healthy',
      needsReconnect: isKnownExpired,
      errors: isKnownExpired ? ['token_expired'] : [],
    }
  } else {
    let token: string | null = null
    try {
      token = resolvePageAccessToken(connection.page_access_token)
    } catch {
      // A sealed token that cannot be opened is a deployment fault (SECRETS_ENC_KEY),
      // not a disconnect: report stored state, never mark the Page expired for it.
      console.error('[FacebookStatus] Page token could not be opened — check SECRETS_ENC_KEY')
    }
    if (token === null) {
      // Same response contract as the cached branch; the stored state stands and
      // nothing is recorded — an unreadable seal is not evidence about the Page.
      health = {
        tokenValid: connection.health_status === 'healthy',
        permissionsOk: connection.health_status === 'healthy',
        subscribed: connection.health_status === 'healthy',
        needsReconnect: false,
        errors: ['token_unreadable'],
      }
    } else {
      health = await checkFacebookConnection(connection.page_id, token)
      if (health.needsReconnect) {
        // Transition-only emit: already-expired short-circuit above never reaches here.
        await markFacebookDisconnectedAndNotify(connection).catch(() => {})
      } else {
        const newStatus = health.subscribed ? 'healthy' : 'not_subscribed'
        await db('facebook_pages')
          .where({ page_id: connection.page_id })
          .update({ health_status: newStatus, health_checked_at: new Date() })
          .catch(() => {})
      }
    }
  }

  let lastLeadAt: string | null = null
  try {
    const lastLead = await db('clients')
      .where({ handlerId: user.id })
      // Both Lead Ads prefixes: this answers "when did this Page last deliver a
      // lead", and an Instagram-placement lead is delivered by the same Page
      // connection. Matching only `facebook:%` would make a healthy Instagram
      // -only Page look like it had never produced a lead.
      .whereRaw(`("leadSource" LIKE ? OR "leadSource" LIKE ?)`, ['facebook:%', 'instagram:%'])
      .orderBy('createdAt', 'desc')
      .select('createdAt')
      .first()
    lastLeadAt = lastLead?.createdAt ?? null
  } catch {
    // Non-critical, don't block the response
  }

  return NextResponse.json({
    connected: true,
    tokenValid: health.tokenValid,
    permissionsOk: health.permissionsOk,
    subscribed: health.subscribed,
    lastLeadAt,
    needsReconnect: health.needsReconnect,
    errors: health.errors,
  })
}
