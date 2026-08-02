import crypto from 'crypto'
import type { DeliveryState } from '@/db/automations/activity'

/**
 * Delivery telemetry ingestion logic (ADR-012) — pure, no I/O.
 *
 * THE PRIME RULE: delivery events never trigger automations. They may only
 * ever SUBTRACT future sends (ladder honesty, address blocks, complaint
 * suppression) — never add, resume, or schedule one. Engagement events
 * (opens/clicks) are not ingested at all; acting on them is a new product
 * decision requiring a superseding ADR.
 *
 * Signature verification implements the provider's Svix scheme by hand (no
 * svix dependency in this repo), mirroring the WhatsApp webhook's manual-HMAC
 * + timingSafeEqual precedent.
 */

const SIGNATURE_TOLERANCE_SEC = 5 * 60

export function verifyWebhookSignature(input: {
  secret: string
  id: string | null
  timestamp: string | null
  signatureHeader: string | null
  body: string
  nowMs: number
}): boolean {
  const { secret, id, timestamp, signatureHeader, body, nowMs } = input
  if (!secret || !id || !timestamp || !signatureHeader) return false

  const ts = Number(timestamp)
  if (!Number.isFinite(ts)) return false
  if (Math.abs(Math.floor(nowMs / 1000) - ts) > SIGNATURE_TOLERANCE_SEC) return false

  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  const expected = crypto.createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64')
  const expectedBuf = Buffer.from(expected)

  // Header is a space-separated list of "version,signature" pairs.
  for (const part of signatureHeader.split(' ')) {
    const [version, signature] = part.split(',')
    if (version !== 'v1' || !signature) continue
    const providedBuf = Buffer.from(signature)
    if (providedBuf.length !== expectedBuf.length) continue
    if (crypto.timingSafeEqual(expectedBuf, providedBuf)) return true
  }
  return false
}

export type DeliveryDecision =
  | { effect: 'ladder'; state: DeliveryState }
  | { effect: 'ladder_and_block'; state: 'bounced' }
  | { effect: 'suppress' }
  | { effect: 'ignore'; reason: string }

type BouncePayload = { bounce?: { type?: string; subType?: string } | null; bounce_type?: string | null }

/**
 * Hard-bounce detection is deliberately CONSERVATIVE: a block is permanent and
 * V1 has no unblock tool (migration plan §8.4), so an address is blocked only
 * on an explicit permanent/hard signal. Anything ambiguous still records the
 * bounce on the ladder but leaves the address usable.
 */
export function isHardBounce(data: BouncePayload | undefined | null): boolean {
  const raw = `${data?.bounce?.type ?? ''} ${data?.bounce_type ?? ''}`.toLowerCase()
  return raw.includes('permanent') || raw.includes('hard')
}

/**
 * The mapping table IS ADR-012's table — code and ADR must not drift. An
 * unlisted type is ignored and logged, never guessed.
 */
export function decideDeliveryEvent(type: string, data: BouncePayload | undefined | null): DeliveryDecision {
  switch (type) {
    case 'email.sent':
      // Already recorded by the worker; the monotonic ladder absorbs it.
      return { effect: 'ladder', state: 'sent' }
    case 'email.delivered':
      return { effect: 'ladder', state: 'delivered' }
    case 'email.bounced':
      return isHardBounce(data) ? { effect: 'ladder_and_block', state: 'bounced' } : { effect: 'ladder', state: 'bounced' }
    case 'email.complained':
      // Not a delivery failure — the mail WAS delivered. Recording it as
      // 'failed' would lie in the activity log; suppression is the honest,
      // protective response.
      return { effect: 'suppress' }
    case 'email.opened':
    case 'email.clicked':
      return { effect: 'ignore', reason: 'engagement_not_ingested' }
    case 'email.delivery_delayed':
      return { effect: 'ignore', reason: 'non_terminal' }
    default:
      return { effect: 'ignore', reason: 'unrecognized_event_type' }
  }
}

/** Single-recipient sends: the address that actually bounced, from the event. */
export function recipientFrom(data: { to?: unknown } | undefined | null): string | null {
  const to = data?.to
  if (Array.isArray(to)) return typeof to[0] === 'string' ? to[0] : null
  return typeof to === 'string' ? to : null
}
