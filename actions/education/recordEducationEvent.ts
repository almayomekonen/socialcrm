'use server'

import { requireBasicCrmAccess } from '@/lib/requireUser'
import { track, type AnalyticsEventName } from '@/lib/analytics/track'

const CLIENT_EMITTABLE = new Set<AnalyticsEventName>([
  'tour_started',
  'tour_step_viewed',
  'tour_completed',
  'tour_dismissed',
  'contextual_help_opened',
  'help_action_clicked',
  'education_action_offered',
  'education_action_clicked',
  'education_tour_started_from_copilot',
])

/**
 * TIER 1. Telemetry is measurement, not a customer capability: it costs
 * nothing and must never be able to break a page. Fire and forget, with the
 * same allowlist and payload validation as before.
 */
export async function recordEducationEvent(event: AnalyticsEventName, props?: Record<string, unknown>): Promise<void> {
  if (!CLIENT_EMITTABLE.has(event)) return
  try {
    const user = await requireBasicCrmAccess()
    await track({ agencyId: user.agencyId, userId: user.id, event, props })
  } catch {
    // Analytics must never break a flow.
  }
}
