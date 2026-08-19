'use server'

import { requireProductAccess } from '@/lib/requireUser'
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

export async function recordEducationEvent(event: AnalyticsEventName, props?: Record<string, unknown>): Promise<void> {
  if (!CLIENT_EMITTABLE.has(event)) return
  try {
    const user = await requireProductAccess()
    await track({ agencyId: user.agencyId, userId: user.id, event, props })
  } catch {
    // Analytics must never break a flow.
  }
}
