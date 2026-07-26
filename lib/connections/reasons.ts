/**
 * Structured activation failure reason codes for the Facebook and WhatsApp
 * connection flows.
 *
 * WHY THIS EXISTS
 * The connection routes historically passed vague `?error=` / `{ error }`
 * strings around, and the WhatsApp path could not distinguish "the app failed
 * to subscribe" from "the phone isn't ready yet". These codes give the routes,
 * analytics, and (later) the recovery UI a single, safe vocabulary.
 *
 * SAFETY: these are opaque enum values only. They MUST NOT carry tokens, OAuth
 * codes, phone numbers, WABA/Page ids, or raw Meta error text. Anything logged
 * or sent to analytics/the client uses these codes, never provider payloads.
 *
 * These are deliberately NOT user-facing copy. The approved Hebrew notices live
 * in `lib/connections/messages.ts`; a reason maps to an existing notice code via
 * the *_NOTICE_CODE maps below so no new copy is introduced here.
 */

export const FB_REASON = {
  NO_PAGES: 'NO_PAGES',
  PAGES_PERMISSION_MISSING: 'PAGES_PERMISSION_MISSING',
  LEADS_PERMISSION_MISSING: 'LEADS_PERMISSION_MISSING',
  ACCESS_DENIED: 'ACCESS_DENIED',
  STATE_INVALID: 'STATE_INVALID',
  CODE_EXPIRED: 'CODE_EXPIRED',
  TOKEN_EXCHANGE_FAILED: 'TOKEN_EXCHANGE_FAILED',
  PAGE_SUBSCRIPTION_FAILED: 'PAGE_SUBSCRIPTION_FAILED',
  RESOURCE_CLAIMED: 'RESOURCE_CLAIMED',
  PROVIDER_ERROR: 'PROVIDER_ERROR',
} as const
export type FbReason = (typeof FB_REASON)[keyof typeof FB_REASON]

export const WA_REASON = {
  SUBSCRIBED_APPS_FAILED: 'SUBSCRIBED_APPS_FAILED',
  PHONE_NOT_READY: 'PHONE_NOT_READY',
  WABA_NOT_FOUND: 'WABA_NOT_FOUND',
  PHONE_NOT_FOUND: 'PHONE_NOT_FOUND',
  ACCESS_DENIED: 'ACCESS_DENIED',
  TOKEN_EXCHANGE_FAILED: 'TOKEN_EXCHANGE_FAILED',
  RESOURCE_CLAIMED: 'RESOURCE_CLAIMED',
  PROVIDER_ERROR: 'PROVIDER_ERROR',
} as const
export type WaReason = (typeof WA_REASON)[keyof typeof WA_REASON]

/**
 * Map a precise reason to an EXISTING approved notice code (the `?error=` /
 * `{ error }` string the components already understand via
 * facebookNotice()/whatsappNotice()). No new user-facing copy is introduced —
 * several distinct reasons intentionally collapse onto the closest approved
 * message, while the precise reason is preserved for analytics. Surfacing the
 * finer distinction in the UI (new approved copy) is deferred to the recovery-UX
 * slice.
 */
export const FB_REASON_NOTICE_CODE: Record<FbReason, string> = {
  NO_PAGES: 'no_pages',
  PAGES_PERMISSION_MISSING: 'pages_permission',
  LEADS_PERMISSION_MISSING: 'missing_permission',
  ACCESS_DENIED: 'denied',
  STATE_INVALID: 'state',
  CODE_EXPIRED: 'token',
  TOKEN_EXCHANGE_FAILED: 'token',
  PAGE_SUBSCRIPTION_FAILED: 'subscription_failed',
  RESOURCE_CLAIMED: 'resource_claimed',
  PROVIDER_ERROR: 'token',
}

export const WA_REASON_NOTICE_CODE: Record<WaReason, string> = {
  SUBSCRIBED_APPS_FAILED: 'subscribe_incomplete',
  PHONE_NOT_READY: 'not_ready',
  WABA_NOT_FOUND: 'no_accounts',
  PHONE_NOT_FOUND: 'no_phones',
  ACCESS_DENIED: 'denied',
  TOKEN_EXCHANGE_FAILED: 'token',
  RESOURCE_CLAIMED: 'resource_claimed',
  PROVIDER_ERROR: 'token',
}
