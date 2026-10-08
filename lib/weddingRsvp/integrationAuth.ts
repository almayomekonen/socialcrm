import { createHmac, timingSafeEqual } from 'crypto'

/**
 * Server-to-server authentication for the Wedding Manager integration.
 *
 *   x-wedding-timestamp: <unix seconds>
 *   x-wedding-signature: v1=<hex HMAC-SHA256(WEDDING_INTEGRATION_SECRET, `${timestamp}.${rawBody}`)>
 *
 * The timestamp is inside the MAC and must be within ±5 minutes, so a captured
 * request cannot be replayed later or altered. The integration is OFF unless
 * WEDDING_INTEGRATION_SECRET (≥ 32 chars) is configured.
 */

export const MAX_SKEW_SECONDS = 300

export function integrationSecret(): string | null {
  const s = process.env.WEDDING_INTEGRATION_SECRET
  return s && s.length >= 32 ? s : null
}

export function signBody(secret: string, timestamp: number, rawBody: string): string {
  return 'v1=' + createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')
}

export type VerifiedRequest = { ok: true; body: unknown } | { ok: false; status: 401 | 400 | 503; error: string }

export function verifyIntegrationRequest(
  rawBody: string,
  timestampHeader: string | null,
  signatureHeader: string | null,
  now = Date.now(),
): VerifiedRequest {
  const secret = integrationSecret()
  if (!secret) return { ok: false, status: 503, error: 'integration-disabled' }
  if (!timestampHeader || !signatureHeader) return { ok: false, status: 401, error: 'unauthorized' }
  const timestamp = Number(timestampHeader)
  if (!Number.isInteger(timestamp) || Math.abs(Math.floor(now / 1000) - timestamp) > MAX_SKEW_SECONDS) {
    return { ok: false, status: 401, error: 'unauthorized' }
  }
  const expected = Buffer.from(signBody(secret, timestamp, rawBody))
  const actual = Buffer.from(signatureHeader)
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return { ok: false, status: 401, error: 'unauthorized' }
  }
  try {
    return { ok: true, body: JSON.parse(rawBody) }
  } catch {
    return { ok: false, status: 400, error: 'invalid-json' }
  }
}

/**
 * Sending is a SEPARATE switch from the integration itself: with only the secret
 * configured, the integration is read-only (statuses, RSVP, export) and
 * send-invitation refuses. Sending needs WEDDING_INTEGRATION_SEND_ENABLED=true.
 */
export function integrationSendEnabled(): boolean {
  return process.env.WEDDING_INTEGRATION_SEND_ENABLED === 'true'
}

/**
 * The template-RSVP send (send-rsvp-request) has its OWN switch, independent of
 * invitations: WEDDING_INTEGRATION_RSVP_SEND_ENABLED=true. Off by default.
 */
export function integrationRsvpSendEnabled(): boolean {
  return process.env.WEDDING_INTEGRATION_RSVP_SEND_ENABLED === 'true'
}
