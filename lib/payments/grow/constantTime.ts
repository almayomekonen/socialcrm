import { timingSafeEqual } from 'crypto'

/**
 * Constant-time string compare, for secrets that arrive from outside — today the
 * process token echoed back in a Grow callback. Length is checked first because
 * timingSafeEqual throws when the buffers differ in length.
 *
 * Previously in lib/payments/growWebhook.ts, which existed for the Payment Link
 * webhooks and went with them.
 */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}
