import type { EmbeddedSignupResult } from '@/lib/facebook/useEmbeddedSignup'

/**
 * How a WhatsApp Embedded Signup launch ended, in the two vocabularies that
 * consume it: analytics (why did it fail?) and the UI (which notice?).
 *
 * Pure, so both answers are decided here and not inside a component.
 */

/**
 * Failures the SERVER NEVER SEES. Every one of these ends inside the browser —
 * Meta's popup closed, the SDK never loaded, the flow timed out — so unless the
 * client reports them they do not exist. That is exactly how production reached
 * 16 `whatsapp_connect_started` across 8 agencies with zero recorded outcomes.
 *
 * Server-originated failures are deliberately absent: the embedded-signup route
 * records its own `whatsapp_connect_failed`, and reporting them again here would
 * double-count.
 */
export const CLIENT_CONNECT_FAILURE_REASONS = ['cancelled', 'sdk', 'timeout', 'config', 'network', 'session'] as const
export type ClientConnectFailureReason = (typeof CLIENT_CONNECT_FAILURE_REASONS)[number]

export function clientConnectFailureReason(result: EmbeddedSignupResult): ClientConnectFailureReason | null {
  if (result.ok) return null
  switch (result.error) {
    case 'cancelled':
      return 'cancelled'
    case 'sdk':
      return result.reason === 'timeout' ? 'timeout' : 'sdk'
    case 'config':
      return 'config'
    case 'network':
      return 'network'
    // Code arrived but Meta's session message (waba_id / phone_number_id) never did.
    case 'missing_details':
      return 'session'
    default:
      return null
  }
}

/**
 * The notice code for a failed launch, or null for none.
 *
 * `cancelled` stays silent on a LIVE connection: dismissing Meta's popup there
 * leaves the health notice in place, as before. With no connection it is the
 * only thing on screen, and on a phone a flow that dies while switching to the
 * WhatsApp Business app also resolves as `cancelled` — so silence there left
 * people tapping the same button with no reason given.
 */
export function whatsappLaunchNoticeCode(result: EmbeddedSignupResult, connected: boolean): string | null {
  if (result.ok) return null
  if (result.error === 'cancelled') return connected ? null : 'not_completed'
  return result.error ?? 'token'
}
