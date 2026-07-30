import { db } from '@/config/db'
import { track } from '@/lib/analytics/track'
import { sendServerEvent, type MetaUserData } from '@/lib/facebook/conversionsApi'

/**
 * Meta Ads "Lead" conversion — the campaign-facing definition.
 *
 * A Lead for the Meta Ads campaign is NOT a registration, a page visit, an
 * onboarding step, a "Connect Facebook" click, an OAuth start, or an OAuth
 * callback. It is exactly one thing:
 *
 *   a newly registered agency has SUCCESSFULLY PERSISTED a Facebook Page
 *   connection (row committed to `facebook_pages`, after the leadgen webhook
 *   subscription was confirmed).
 *
 * That point lives in `app/api/auth/facebook/connect/route.ts`, immediately after
 * the upsert. Nothing earlier in the flow persists anything — the OAuth callback
 * only writes a short-lived encrypted cookie — so nothing earlier may fire this.
 *
 * IDEMPOTENCY — two independent layers, because a paid conversion counted twice is
 * a real financial reporting error:
 *
 *   1. Local marker: a `meta_capi_lead_sent` row in `analytics_events`, scoped per
 *      agency. Checked before sending, written only after a confirmed send. This
 *      survives disconnect → reconnect (the disconnect route deletes the
 *      `facebook_pages` row, but never analytics history), callback retries,
 *      refreshes, and repeated OAuth flows.
 *   2. Deterministic `event_id`: Meta collapses events sharing (event_id,
 *      event_name), so even a race between two concurrent connects — where both
 *      pass the existence check before either writes the marker — is deduplicated
 *      Meta-side. This mirrors the acknowledged best-effort race in
 *      `trackFirstRealLeadOnce`, but with a real backstop.
 *
 * A failed send deliberately does NOT write the marker, so the next successful
 * connection retries the conversion. A successful send always writes it.
 *
 * Scoped per AGENCY, not per user: the agency is the tenant that converted, and it
 * matches both the `facebook_pages` tenancy model and the `trackFirstRealLeadOnce`
 * precedent. Two users in one agency connecting Pages is one business conversion.
 */

const LOG_PREFIX = '[meta-lead-conversion]'

/**
 * Deterministic dedup key for the Facebook-connected Lead conversion.
 *
 * Exported so that if a browser Pixel `Lead` is ever added for this same
 * conversion, it can pass the identical `eventID` to fbq() and Meta will count the
 * pair once. Today no Pixel `Lead` is fired anywhere — CAPI is the sole source —
 * so there is nothing to double count.
 */
export function facebookConnectedLeadEventId(agencyId: number): string {
  return `fb-connected-lead-agency-${agencyId}`
}

export type FacebookConnectedLeadInput = {
  agencyId: number
  userId: number
  email?: string | null
  /** Request-scope signals, captured before the response is sent. */
  clientIp?: string | null
  clientUserAgent?: string | null
  fbp?: string | null
  fbc?: string | null
  eventSourceUrl?: string | null
}

/**
 * Fire the Meta `Lead` conversion exactly once per agency, on first successful,
 * persisted Facebook connection.
 *
 * NEVER throws. A Meta tracking failure must never surface to — let alone fail —
 * the Facebook connection itself. Intended to be called from `after()` so it runs
 * once the HTTP response has already been sent.
 */
export async function sendFacebookConnectedLeadOnce(input: FacebookConnectedLeadInput): Promise<void> {
  const { agencyId, userId } = input
  try {
    const eventId = facebookConnectedLeadEventId(agencyId)

    const alreadySent = await db('analytics_events').where({ agencyId, event: 'meta_capi_lead_sent' }).first()
    if (alreadySent) {
      console.log(`${LOG_PREFIX}:skip`, { agencyId, reason: 'already_sent' })
      return
    }

    const userData: MetaUserData = {
      email: input.email,
      externalId: userId,
      clientIp: input.clientIp,
      clientUserAgent: input.clientUserAgent,
      fbp: input.fbp,
      fbc: input.fbc,
    }

    const result = await sendServerEvent({
      eventName: 'Lead',
      eventId,
      eventSourceUrl: input.eventSourceUrl,
      userData,
      customData: { content_name: 'facebook_connected' },
    })

    if (result.status !== 'sent') {
      // No marker written — a later successful connection will retry the
      // conversion rather than silently losing it.
      console.warn(`${LOG_PREFIX}:not_sent`, { agencyId, status: result.status, reason: result.reason })
      return
    }

    await track({ agencyId, userId, event: 'meta_capi_lead_sent', props: { eventId, source: 'facebook_connected' } })
    console.log(`${LOG_PREFIX}:sent`, { agencyId, userId, eventId })
  } catch (err) {
    console.error(`${LOG_PREFIX}:failed`, { agencyId, reason: (err as Error)?.message ?? String(err) })
  }
}
