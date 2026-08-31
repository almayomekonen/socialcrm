'use server'

import { requireBasicCrmAccess } from '@/lib/requireUser'
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
  'first_run_viewed',
  'connection_offered',
  'connection_deferred',
])

export type LeadActionSurface = 'mobile' | 'desktop'
export type LeadActionKind = 'status' | 'follow_up' | 'assign' | 'message' | 'note' | 'outcome'

const SURFACES = new Set<LeadActionSurface>(['mobile', 'desktop'])
const ACTIONS = new Set<LeadActionKind>(['status', 'follow_up', 'assign', 'message', 'note', 'outcome'])

/**
 * TIER 1. Telemetry is measurement, not a customer capability: it costs
 * nothing and must never be able to break a page. Fire and forget, with the
 * same allowlist and payload validation as before.
 */
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

  /**
   * `first_run_viewed` carries two connection flags. They are COERCED to real
   * booleans rather than forwarded as-is: this action's contract is that
   * untrusted client input never reaches `props` unchecked, and a client that
   * posted `metaConnected: "yes"` would otherwise put a string into a jsonb
   * field every funnel query reads as a boolean. Coercion, not rejection —
   * a malformed flag must not cost us the view event itself.
   */
  const safeProps =
    props && (props.metaConnected !== undefined || props.whatsappConnected !== undefined)
      ? {
          ...props,
          ...(props.metaConnected !== undefined ? { metaConnected: props.metaConnected === true } : {}),
          ...(props.whatsappConnected !== undefined ? { whatsappConnected: props.whatsappConnected === true } : {}),
        }
      : props

  try {
    const user = await requireBasicCrmAccess()
    await track({ agencyId: user.agencyId, userId: user.id, event, props: safeProps })
  } catch {
    // Analytics must never break a flow; swallow auth/db hiccups.
  }
}
