'use server'

import { getUser } from '@/db/auth'
import { track, type AnalyticsEventName } from '@/lib/analytics/track'

export async function trackActivation(event: AnalyticsEventName): Promise<void> {
  const user = await getUser()
  if (!user) return
  await track({ agencyId: user.agencyId, userId: user.id, event })
}
