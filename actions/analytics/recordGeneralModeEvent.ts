'use server'

import { requireAgencyUser } from '@/lib/requireUser'
import { track, type AnalyticsEventName } from '@/lib/analytics/track'

/**
 * Client islands can only emit this fixed subset of General Mode events. Server
 * actions (briefing / Q&A) emit the rest directly. Keeping the allowlist here
 * means a client cannot spoof arbitrary analytics events through this bridge.
 */
const CLIENT_EMITTABLE = new Set<AnalyticsEventName>(['general_mode.opened', 'general_mode.deeplink_clicked'])

export async function recordGeneralModeEvent(
  event: AnalyticsEventName,
  props?: Record<string, unknown>,
): Promise<void> {
  if (!CLIENT_EMITTABLE.has(event)) return
  try {
    const user = await requireAgencyUser()
    await track({ agencyId: user.agencyId, userId: user.id, event, props })
  } catch {
    // Analytics must never break a flow; swallow auth/db hiccups.
  }
}
