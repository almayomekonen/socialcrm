'use server'

import { requireBasicCrmAccess } from '@/lib/requireUser'
import { track, type AnalyticsEventName } from '@/lib/analytics/track'
import { getInAppBrowser } from '@/lib/device'
import { CLIENT_CONNECT_FAILURE_REASONS } from '@/lib/connections/connectFailure'
import { EMBEDDED_SIGNUP_STEPS } from '@/lib/whatsapp/coexistenceEvents'
import { hasServerConnectOutcomeSince } from '@/lib/analytics/connectOutcome'

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
  /**
   * The WhatsApp connect DENOMINATOR. It has to be client-emittable because the
   * real entry point is the Meta Embedded Signup dialog launched in the browser
   * — the server sees nothing until that dialog SUCCEEDS, which is exactly the
   * abandonment this event exists to measure.
   */
  'whatsapp_connect_started',
  /**
   * The WhatsApp connect outcomes the server never sees (popup closed, SDK never
   * loaded, timeout). Client-emittable for the same reason as the denominator;
   * its `reason` has its own vocabulary and `stage` is stamped here, never taken
   * from the client.
   */
  'whatsapp_connect_failed',
  /**
   * THE CONTACT TRIAD. Client-emittable because the outcome of a contact attempt
   * is only knowable in the browser: the native-WhatsApp handoff is a plain
   * anchor navigation the server never sees, so a server-side emitter could
   * record intent but never resolution.
   */
  'lead_contact_clicked',
  'lead_contact_blocked',
  'lead_contact_succeeded',
])

export type LeadActionSurface = 'mobile' | 'desktop'
export type LeadActionKind = 'status' | 'follow_up' | 'assign' | 'message' | 'note' | 'outcome'

const SURFACES = new Set<LeadActionSurface>(['mobile', 'desktop'])
const ACTIONS = new Set<LeadActionKind>(['status', 'follow_up', 'assign', 'message', 'note', 'outcome'])

/**
 * Contact-triad vocabularies. Validated, never coerced, on the same rule as
 * `surface` and `action` above: a silently-defaulted reason would corrupt the
 * one field the blocked event exists to carry.
 */
export type LeadContactBlockedReason = 'no_phone' | 'no_connection' | 'window_unknown' | 'window_closed_no_template'
export type LeadContactChannel = 'whatsapp_api' | 'whatsapp_native' | 'phone'

const BLOCKED_REASONS = new Set<LeadContactBlockedReason>([
  'no_phone',
  'no_connection',
  'window_unknown',
  'window_closed_no_template',
])
const CHANNELS = new Set<LeadContactChannel>(['whatsapp_api', 'whatsapp_native', 'phone'])
const CONNECT_FAILURE_REASONS = new Set<string>(CLIENT_CONNECT_FAILURE_REASONS)
const SIGNUP_STEPS = new Set<string>(EMBEDDED_SIGNUP_STEPS)
const MAX_CONNECT_ELAPSED_MS = 86_400_000
const ABANDONED_LOOKBACK_SLACK_MS = 5_000

/**
 * The detail a connect failure may carry: the Meta screen it stopped on, Meta's
 * numeric error id, and how long it ran. Each field is kept only if it passes
 * its own check — a bad field is dropped, never the failure itself. Meta's error
 * TEXT is deliberately not accepted: it is shown to the customer, not stored.
 */
function connectFailureDetail(props: Record<string, unknown> | undefined): Record<string, string | number> {
  const detail: Record<string, string | number> = {}
  if (typeof props?.step === 'string' && SIGNUP_STEPS.has(props.step)) detail.step = props.step
  if (typeof props?.metaErrorId === 'string' && /^\d{1,20}$/.test(props.metaErrorId)) detail.metaErrorId = props.metaErrorId
  const elapsed = props?.elapsedMs
  if (typeof elapsed === 'number' && Number.isFinite(elapsed) && elapsed >= 0) {
    detail.elapsedMs = Math.min(Math.round(elapsed), MAX_CONNECT_ELAPSED_MS)
  }
  return detail
}

/**
 * TIER 1. Telemetry is measurement, not a customer capability: it costs
 * nothing and must never be able to break a page. Fire and forget, with the
 * same allowlist and payload validation as before.
 */
export async function recordLeadActionEvent(
  event: AnalyticsEventName,
  props?: { surface?: string; action?: string; reason?: string; channel?: string; intendedChannel?: string; [k: string]: unknown },
): Promise<void> {
  if (!CLIENT_EMITTABLE.has(event)) return

  const surface = props?.surface
  const action = props?.action
  // Reject rather than coerce: a silently-defaulted 'desktop' on a mobile action
  // would corrupt the very split this event exists to measure.
  if (surface !== undefined && !SURFACES.has(surface as LeadActionSurface)) return
  if (action !== undefined && !ACTIONS.has(action as LeadActionKind)) return

  const reason = props?.reason
  const channel = props?.channel
  const intendedChannel = props?.intendedChannel
  const isConnectFailure = event === 'whatsapp_connect_failed'
  // A connect failure without a known reason is worthless — reject it outright.
  if (isConnectFailure && !CONNECT_FAILURE_REASONS.has(reason ?? '')) return
  if (!isConnectFailure && reason !== undefined && !BLOCKED_REASONS.has(reason as LeadContactBlockedReason)) return
  if (channel !== undefined && !CHANNELS.has(channel as LeadContactChannel)) return
  if (intendedChannel !== undefined && !CHANNELS.has(intendedChannel as LeadContactChannel)) return

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

  const connectDetail = isConnectFailure ? connectFailureDetail(props) : {}
  // `abandoned` must be bounded to its attempt, or it cannot be checked below.
  if (reason === 'abandoned' && typeof connectDetail.elapsedMs !== 'number') return

  try {
    const user = await requireBasicCrmAccess()
    /**
     * An abandoned attempt whose page was reloaded while the server was
     * finishing it already has an outcome — success or a server-stage failure.
     * Recording `abandoned` too would contradict it, so it is dropped. The
     * slack covers the gap between the click and the server's own clock.
     */
    if (reason === 'abandoned') {
      const since = new Date(Date.now() - Number(connectDetail.elapsedMs) - ABANDONED_LOOKBACK_SLACK_MS)
      if (await hasServerConnectOutcomeSince(user.agencyId, since)) return
    }
    /**
     * WhatsApp connect events carry ONLY server-built props. `inApp` comes from
     * this request's own User-Agent (the Server Action POST is the same browser),
     * so nothing the client sends can claim or hide an in-app browser. `null`
     * means "checked, not in-app" — distinct from events recorded before this.
     */
    const inApp = () => getInAppBrowser().catch(() => null)
    const eventProps =
      event === 'whatsapp_connect_started'
        ? { inApp: await inApp() }
        : isConnectFailure
          ? { reason, stage: 'client', inApp: await inApp(), ...connectDetail }
          : safeProps
    await track({ agencyId: user.agencyId, userId: user.id, event, props: eventProps })
  } catch {
    // Analytics must never break a flow; swallow auth/db hiccups.
  }
}
