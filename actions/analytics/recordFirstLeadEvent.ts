'use server'

import { requireBasicCrmAccess } from '@/lib/requireUser'
import { track, type AnalyticsEventName } from '@/lib/analytics/track'

/**
 * Client bridge for the manual first-lead "Aha" funnel. The first-run create
 * path and the FirstLeadCallout are client components; they emit these three
 * events through here. An allowlist keeps a client from spoofing arbitrary
 * analytics events, exactly like recordGeneralModeEvent. Fire-and-forget:
 * analytics must never break the lead flow, so all failures are swallowed.
 */
const CLIENT_EMITTABLE = new Set<AnalyticsEventName>([
  'first_manual_lead_created',
  'first_lead_opened',
  'first_follow_up_set',
])

/**
 * TIER 1. Telemetry is measurement, not a customer capability: it costs
 * nothing and must never be able to break a page. Fire and forget, with the
 * same allowlist and payload validation as before.
 */
export async function recordFirstLeadEvent(
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
