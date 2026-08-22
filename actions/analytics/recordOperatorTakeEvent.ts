'use server'

import { requireBasicCrmAccess } from '@/lib/requireUser'
import { track, type AnalyticsEventName } from '@/lib/analytics/track'

/** Client islands may only emit this fixed subset — cannot spoof arbitrary events. */
const CLIENT_EMITTABLE = new Set<AnalyticsEventName>([
  'operator_take.rendered',
  'operator_take.suppressed',
  'operator_take.citation_opened',
  'operator_take.dismissed',
])

/**
 * TIER 1. Telemetry is measurement, not a customer capability: it costs
 * nothing and must never be able to break a page. Fire and forget, with the
 * same allowlist and payload validation as before.
 */
export async function recordOperatorTakeEvent(
  event: AnalyticsEventName,
  props?: Record<string, unknown>,
): Promise<void> {
  if (!CLIENT_EMITTABLE.has(event)) return
  try {
    const user = await requireBasicCrmAccess()
    await track({ agencyId: user.agencyId, userId: user.id, event, props })
  } catch {
    // Analytics must never break a flow; swallow auth/db hiccups.
  }
}
