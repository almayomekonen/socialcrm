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
export const CLIENT_CONNECT_FAILURE_REASONS = [
  'cancelled',
  'sdk',
  // No longer sent: the five-minute valve now reports `whatsapp_connect_pending`.
  // Kept so a tab loaded before the change can still report it.
  'timeout',
  'config',
  'network',
  'session',
  // Meta showed the customer an error inside its flow and they reported it.
  'meta_error',
  // The page was reloaded or left while an attempt was still open; reported on
  // the next visit, from lib/connections/pendingConnectAttempt.ts.
  'abandoned',
] as const
export type ClientConnectFailureReason = (typeof CLIENT_CONNECT_FAILURE_REASONS)[number]

export function clientConnectFailureReason(result: EmbeddedSignupResult): ClientConnectFailureReason | null {
  if (result.ok) return null
  switch (result.error) {
    case 'cancelled':
      return result.cancel?.errorReported ? 'meta_error' : 'cancelled'
    case 'sdk':
      return 'sdk'
    case 'config':
      return 'config'
    case 'network':
      return 'network'
    // Code arrived but Meta's session message (waba_id / phone_number_id) never did.
    case 'missing_details':
      return 'session'
    // `pending` is not a failure: the window may still be open. Server failures
    // are recorded by the route.
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
 *
 * Two cancels are more specific than "not completed", because Meta told us why:
 * an error Meta showed the customer (retrying unchanged would fail again, so it
 * is shown even on a live connection), and a flow that stopped at phone-number
 * verification (the customer needs the business phone at hand).
 */
export function whatsappLaunchNoticeCode(result: EmbeddedSignupResult, connected: boolean): string | null {
  if (result.ok) return null
  if (result.error === 'cancelled') {
    if (result.cancel?.errorReported) return 'meta_error'
    if (connected) return null
    return result.cancel?.step === 'PHONE_NUMBER_VERIFICATION' ? 'verification_incomplete' : 'not_completed'
  }
  return result.error ?? 'token'
}
