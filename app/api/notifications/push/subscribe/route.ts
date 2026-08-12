import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/db/auth'
import { getAgencyProductAccess } from '@/lib/access/productAccess'
import { upsertPushSubscription } from '@/db/notifications/subscriptions'
import { isNotificationsAgencyAllowlisted, isNotificationsEnabled } from '@/lib/notifications/flags'
import { parsePushSubscriptionBody, truncateUserAgent } from '@/lib/notifications/pushSubscriptionSchema'
import { getVapidConfig } from '@/lib/notifications/vapid'

/**
 * POST /api/notifications/push/subscribe — P3.1. Spec §15.3, §20.5.
 *
 * Binds a browser PushSubscription to the SESSION's agencyId + userId.
 * Never accepts agencyId/userId from the body. Reassigns an existing endpoint
 * to this user (device changing hands). Does NOT send a push. Does NOT write
 * notification_deliveries.
 */

const NO_STORE = { 'Cache-Control': 'no-store' } as const

export async function POST(req: NextRequest) {
  const user = await getUser()
  if (!user?.agencyId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE })
  if (!(await getAgencyProductAccess(user.agencyId)).hasAccess) {
    return NextResponse.json({ error: 'product-access-required' }, { status: 403, headers: NO_STORE })
  }
  if (!isNotificationsEnabled() || !isNotificationsAgencyAllowlisted(user.agencyId)) {
    return NextResponse.json({ error: 'notifications-disabled' }, { status: 404, headers: NO_STORE })
  }

  const vapid = getVapidConfig()
  if (vapid.status !== 'configured') {
    return NextResponse.json(
      { error: 'not_configured', vapidStatus: vapid.status, missing: vapid.missing },
      { status: 503, headers: NO_STORE },
    )
  }

  const body = await req.json().catch(() => null)
  const parsed = parsePushSubscriptionBody(body)
  if (!parsed.ok) {
    return NextResponse.json({ error: 'invalid-subscription' }, { status: 400, headers: NO_STORE })
  }

  // Session owns the binding. Body fields agencyId/userId/phone/email are ignored
  // because they never leave the Zod strip — only endpoint/keys reach the write.
  const row = await upsertPushSubscription({
    agencyId: user.agencyId,
    userId: user.id,
    endpoint: parsed.value.endpoint,
    p256dh: parsed.value.keys.p256dh,
    auth: parsed.value.keys.auth,
    userAgent: truncateUserAgent(req.headers.get('user-agent')),
  })

  return NextResponse.json(
    {
      ok: true,
      id: row.id,
      endpoint: row.endpoint,
      // Echo the session binding so tests can assert the body never won.
      agencyId: row.agencyId,
      userId: row.userId,
    },
    { headers: NO_STORE },
  )
}
