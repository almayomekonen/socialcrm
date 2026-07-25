'use server'

import { requireProductAccess } from '@/lib/requireUser'
import { track, type AnalyticsEventName } from '@/lib/analytics/track'

/** Client islands may only emit this fixed subset — cannot spoof arbitrary events. */
const CLIENT_EMITTABLE = new Set<AnalyticsEventName>([
  'operator_take.rendered',
  'operator_take.suppressed',
  'operator_take.citation_opened',
  'operator_take.dismissed',
])

export async function recordOperatorTakeEvent(
  event: AnalyticsEventName,
  props?: Record<string, unknown>,
): Promise<void> {
  if (!CLIENT_EMITTABLE.has(event)) return
  try {
    const user = await requireProductAccess()
    await track({ agencyId: user.agencyId, userId: user.id, event, props })
  } catch {
    // Analytics must never break a flow; swallow auth/db hiccups.
  }
}
