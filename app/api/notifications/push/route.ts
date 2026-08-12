import { NextResponse } from 'next/server'
import { getUser } from '@/db/auth'
import { getAgencyProductAccess } from '@/lib/access/productAccess'
import { countUserPushSubscriptions } from '@/db/notifications/subscriptions'
import { isNotificationsAgencyAllowlisted, isNotificationsEnabled, isNotificationsPushEnabled } from '@/lib/notifications/flags'
import { getVapidConfig } from '@/lib/notifications/vapid'

/**
 * Push subscription lifecycle status — P3.1. Spec §15.3, §23.2.
 *
 * Reports configuration state explicitly. Does NOT send a push. Does NOT
 * enable WEB_PUSH routing — `pushChannelEnabled` mirrors the env flag and is
 * expected to be false until a later phase turns it on.
 */

const NO_STORE = { 'Cache-Control': 'no-store' } as const

export async function GET() {
  const user = await getUser()
  if (!user?.agencyId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE })
  if (!(await getAgencyProductAccess(user.agencyId)).hasAccess) {
    return NextResponse.json({ error: 'product-access-required' }, { status: 403, headers: NO_STORE })
  }
  if (!isNotificationsEnabled() || !isNotificationsAgencyAllowlisted(user.agencyId)) {
    return NextResponse.json({ error: 'notifications-disabled' }, { status: 404, headers: NO_STORE })
  }

  const vapid = getVapidConfig()
  const subscriptionCount = await countUserPushSubscriptions({
    agencyId: user.agencyId,
    userId: user.id,
  })

  return NextResponse.json(
    {
      vapidStatus: vapid.status,
      missing: vapid.missing,
      publicKey: vapid.publicKey,
      /** Delivery channel gate — still off in P3.1; lifecycle can still subscribe. */
      pushChannelEnabled: isNotificationsPushEnabled(),
      subscriptionCount,
      serviceWorkerUrl: '/sw.js',
    },
    { headers: NO_STORE },
  )
}
