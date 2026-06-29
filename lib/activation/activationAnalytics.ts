import type { AnalyticsEventName } from '@/lib/analytics/track'

/**
 * The ONLY activation events we track — KPI-driving milestones, nothing else.
 * Pure data (type-only import, no runtime deps). The controller calls
 * `trackActivation` (actions/activation) directly at each milestone.
 * Adding to this list requires proving the new event drives a decision.
 */
export const ACTIVATION_EVENTS: readonly AnalyticsEventName[] = [
  'activation_started',
  'oauth_completed',
  'subscription_completed',
  'subscription_failed',
  'activation_abandoned',
]
