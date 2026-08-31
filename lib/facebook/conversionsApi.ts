import { createHash } from 'crypto'
import { GRAPH_BASE } from '@/lib/facebook/graph'
import { isMetaTrackingEnabled } from '@/lib/facebook/pixelEnv'

/**
 * Meta Conversions API (CAPI) — server-side event sender.
 *
 * This is the ONLY server-side Meta events transport in the codebase. The browser
 * Pixel (`lib/facebook/MetaPixel.tsx` + `lib/facebook/pixelEvents.ts`) remains the
 * client-side transport for its own events. Do not add a second CAPI client.
 *
 * DATASET: deliberately reads `NEXT_PUBLIC_META_PIXEL_ID` — the same id the browser
 * Pixel initialises with — so server events can never land in a different dataset
 * than the Ads campaign's ("Social CRM Production", 2587091141705317). There is no
 * separate dataset override on purpose: one knob, one destination.
 *
 * Every function here is failure-swallowing by contract. A Meta outage, a bad token,
 * or a malformed response must never propagate to the caller's business flow.
 */

const LOG_PREFIX = '[meta-capi]'

/** Meta standard events we send server-side. Extend deliberately. */
export type MetaServerEvent = 'Lead'

export type MetaUserData = {
  /** Raw email — hashed here, never sent in clear. */
  email?: string | null
  /** Raw stable user id — hashed here. Improves match quality. */
  externalId?: string | number | null
  /** Sent unhashed, per Meta spec. */
  clientIp?: string | null
  clientUserAgent?: string | null
  /** `_fbp` / `_fbc` browser cookies. Sent unhashed, per Meta spec. */
  fbp?: string | null
  fbc?: string | null
}

export type SendServerEventInput = {
  eventName: MetaServerEvent
  /**
   * Deduplication key. Meta collapses events sharing (event_id, event_name), which
   * protects against both Pixel/CAPI double counting and same-source retries.
   * Callers MUST pass a deterministic value derived from the conversion identity.
   */
  eventId: string
  /** Unix seconds. Defaults to now. Meta rejects events older than 7 days. */
  eventTime?: number
  eventSourceUrl?: string | null
  userData: MetaUserData
  customData?: Record<string, unknown>
}

export type SendServerEventResult =
  | { status: 'sent'; eventId: string }
  | { status: 'skipped'; reason: 'not_configured' | 'no_identifier' }
  | { status: 'failed'; reason: string }

/** Meta requires SHA-256 hex of the normalised (trimmed, lowercased) value. */
function hash(value: string): string {
  return createHash('sha256').update(value.trim().toLowerCase()).digest('hex')
}

function readConfig() {
  const datasetId = process.env.NEXT_PUBLIC_META_PIXEL_ID?.trim()
  const accessToken = process.env.META_CAPI_ACCESS_TOKEN?.trim()
  const testEventCode = process.env.META_CAPI_TEST_EVENT_CODE?.trim()
  return { datasetId, accessToken, testEventCode }
}

function buildUserData(userData: MetaUserData): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (userData.email?.trim()) out.em = [hash(userData.email)]
  if (userData.externalId !== null && userData.externalId !== undefined && String(userData.externalId).trim()) {
    out.external_id = [hash(String(userData.externalId))]
  }
  // Unhashed by Meta's spec — these are not PII fields in CAPI terms.
  if (userData.clientIp) out.client_ip_address = userData.clientIp
  if (userData.clientUserAgent) out.client_user_agent = userData.clientUserAgent
  if (userData.fbp) out.fbp = userData.fbp
  if (userData.fbc) out.fbc = userData.fbc
  return out
}

/**
 * Send one server-side event to the Meta Conversions API.
 *
 * NEVER throws and NEVER rejects — always resolves to a result object. Callers are
 * free to ignore the return value entirely.
 */
export async function sendServerEvent(input: SendServerEventInput): Promise<SendServerEventResult> {
  try {
    // Environment gate, BEFORE readConfig(). A preview or a laptop inherits the
    // production dataset id from `.env`, so a configured CAPI token there would
    // otherwise post real server events into the production dataset.
    // Deliberately reuses the existing 'not_configured' reason so
    // `SendServerEventResult` is unchanged; the distinct log line keeps it
    // diagnosable. See lib/facebook/pixelEnv.ts.
    if (!isMetaTrackingEnabled()) {
      console.log(`${LOG_PREFIX}:skip`, {
        event: input.eventName,
        reason: 'not_configured',
        gate: 'meta_tracking_disabled',
        vercelEnv: process.env.NEXT_PUBLIC_VERCEL_ENV ?? null,
      })
      return { status: 'skipped', reason: 'not_configured' }
    }

    const { datasetId, accessToken, testEventCode } = readConfig()

    if (!datasetId || !accessToken) {
      // Expected in local/dev/preview where CAPI is intentionally unconfigured.
      console.log(`${LOG_PREFIX}:skip`, {
        event: input.eventName,
        reason: 'not_configured',
        hasDataset: !!datasetId,
        hasToken: !!accessToken,
      })
      return { status: 'skipped', reason: 'not_configured' }
    }

    const userData = buildUserData(input.userData)
    if (Object.keys(userData).length === 0) {
      // Meta rejects events with no identifier; skipping is cheaper than a 400.
      console.warn(`${LOG_PREFIX}:skip`, { event: input.eventName, reason: 'no_identifier' })
      return { status: 'skipped', reason: 'no_identifier' }
    }

    const payload: Record<string, unknown> = {
      data: [
        {
          event_name: input.eventName,
          event_time: input.eventTime ?? Math.floor(Date.now() / 1000),
          event_id: input.eventId,
          action_source: 'website',
          ...(input.eventSourceUrl ? { event_source_url: input.eventSourceUrl } : {}),
          user_data: userData,
          ...(input.customData ? { custom_data: input.customData } : {}),
        },
      ],
    }
    if (testEventCode) payload.test_event_code = testEventCode

    const res = await fetch(`${GRAPH_BASE}/${datasetId}/events?access_token=${encodeURIComponent(accessToken)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    })

    if (!res.ok) {
      // Body may contain the Graph error code — useful, and contains no user PII
      // beyond what we already hashed.
      const body = await res.text().catch(() => '<unreadable>')
      console.error(`${LOG_PREFIX}:failed`, {
        event: input.eventName,
        eventId: input.eventId,
        status: res.status,
        body: body.slice(0, 500),
      })
      return { status: 'failed', reason: `http_${res.status}` }
    }

    console.log(`${LOG_PREFIX}:sent`, {
      event: input.eventName,
      eventId: input.eventId,
      datasetId,
      test: !!testEventCode,
    })
    return { status: 'sent', eventId: input.eventId }
  } catch (err) {
    console.error(`${LOG_PREFIX}:threw`, {
      event: input.eventName,
      eventId: input.eventId,
      reason: (err as Error)?.message ?? String(err),
    })
    return { status: 'failed', reason: 'exception' }
  }
}
