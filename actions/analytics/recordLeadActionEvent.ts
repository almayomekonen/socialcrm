'use server'

import { requireProductAccess } from '@/lib/requireUser'
import { track, type AnalyticsEventName } from '@/lib/analytics/track'

/**
 * Client bridge for the activation milestone: a rep acted on a lead.
 *
 * ONE event, both surfaces. `surface` is a prop, not a second event name — see
 * the `lead_action_taken` comment in lib/analytics/track.ts for why splitting it
 * would break the Activation KPI.
 *
 * Allowlisted exactly like `recordFirstLeadEvent` / `recordGeneralModeEvent`, so
 * a client can never post an arbitrary analytics event name, and both `surface`
 * and `action` are validated against fixed vocabularies rather than passed
 * through — untrusted client input must never reach `props` unchecked.
 *
 * Fire-and-forget: analytics must never break a lead flow, so every failure
 * (auth, db) is swallowed. Callers do not await a result.
 */

const CLIENT_EMITTABLE = new Set<AnalyticsEventName>([
  'lead_action_taken',
  'lead_created_manual',
  'mobile_lead_opened',
  'mobile_workspace_viewed',
  'connection_offered',
  'connection_deferred',
])

export type LeadActionSurface = 'mobile' | 'desktop'
export type LeadActionKind = 'status' | 'follow_up' | 'assign' | 'message' | 'note' | 'outcome'

const SURFACES = new Set<LeadActionSurface>(['mobile', 'desktop'])
const ACTIONS = new Set<LeadActionKind>(['status', 'follow_up', 'assign', 'message', 'note', 'outcome'])

export async function recordLeadActionEvent(
  event: AnalyticsEventName,
  props?: { surface?: string; action?: string; [k: string]: unknown },
): Promise<void> {
  if (!CLIENT_EMITTABLE.has(event)) return

  const surface = props?.surface
  const action = props?.action
  // Reject rather than coerce: a silently-defaulted 'desktop' on a mobile action
  // would corrupt the very split this event exists to measure.
  if (surface !== undefined && !SURFACES.has(surface as LeadActionSurface)) return
  if (action !== undefined && !ACTIONS.has(action as LeadActionKind)) return

  try {
    const user = await requireProductAccess()
    await track({ agencyId: user.agencyId, userId: user.id, event, props })
  } catch {
    // Analytics must never break a flow; swallow auth/db hiccups.
  }
}
