/**
 * Embedded Signup event constants — the ONLY part of Coexistence the browser
 * may see.
 *
 * WHY THIS MODULE EXISTS. `lib/whatsapp/coexistence.ts` is server-only: it
 * ingests webhooks, writes to Postgres and reads the session. But the Embedded
 * Signup client needs three pure protocol values from it, and importing *any*
 * symbol from a module pulls that module's whole graph into the bundle. That
 * dragged `db/auth.ts` (`next/headers`, `cacheTag`, inline `'use cache'`) and
 * `config/db.ts` (knex → `fs`) into the Client Component Browser graph and broke
 * the production build.
 *
 * So the boundary is drawn where it already existed conceptually: the postMessage
 * PROTOCOL the browser speaks lives here, and everything that ACTS on it lives
 * in `coexistence.ts`, which re-exports these so no server caller changes.
 *
 * THIS FILE MUST NEVER IMPORT ANYTHING. That is the entire contract — a single
 * import of a module that touches the database, the session or the filesystem
 * puts it back in the browser bundle. A test asserts the import count is zero.
 */

/** Meta's Embedded Signup completion event for a standard Cloud API onboarding. */
export const ES_EVENT_FINISH = 'FINISH'

/**
 * Meta's completion event for a WhatsApp Business app (Coexistence) onboarding.
 * The two are distinguished here because only the second one has an archive and
 * a 24-hour synchronisation window.
 */
export const ES_EVENT_FINISH_COEXISTENCE = 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING'

/**
 * Meta's completion event for a flow finished without a phone number. Meta
 * documents it; the number may still be discoverable from the account.
 */
export const ES_EVENT_FINISH_ONLY_WABA = 'FINISH_ONLY_WABA'

/** Which flavour of onboarding the browser reported completing. */
export type OnboardingType = 'cloud_api' | 'coexistence'

/** Meta's event when the customer leaves the flow early or reports an error in it. */
export const ES_EVENT_CANCEL = 'CANCEL'

/** Meta's event when the customer reports an error from inside the flow. */
export const ES_EVENT_ERROR = 'ERROR'

/** Every event name Meta documents. Anything else is recorded as OTHER. */
export const META_SIGNUP_EVENTS = [
  ES_EVENT_FINISH,
  ES_EVENT_FINISH_COEXISTENCE,
  ES_EVENT_FINISH_ONLY_WABA,
  'FINISH_GRANT_ONLY_API_ACCESS',
  ES_EVENT_CANCEL,
  ES_EVENT_ERROR,
  'OTHER',
] as const
export type MetaSignupEvent = (typeof META_SIGNUP_EVENTS)[number]

/**
 * The screens Meta names in a CANCEL event's `current_step`. Anything else is
 * recorded as OTHER, so a new Meta screen never puts an arbitrary string into
 * analytics. Source: Embedded Signup "Abandoned Flow Screens".
 */
export const EMBEDDED_SIGNUP_STEPS = [
  'BUSINESS_ACCOUNT_SELECTION',
  'WABA_PHONE_PROFILE_PICKER',
  'WHATSAPP_BUSINESS_PROFILE_SETUP',
  'PHONE_NUMBER_SETUP',
  'PHONE_NUMBER_VERIFICATION',
  'PERMISSIONS',
  'OTHER',
] as const
export type EmbeddedSignupStep = (typeof EMBEDDED_SIGNUP_STEPS)[number]

/** Meta's numeric error code, string or number; anything else is dropped. */
export const META_ERROR_ID = /^\d{1,20}$/
/**
 * Meta documents the session id's purpose (for support) and one example
 * (`f34b51dab5e0498`), not its format: a conservative allowlist and bound, and
 * a non-matching id is DROPPED, never rewritten (an altered id misleads support).
 */
export const META_SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/

export function metaErrorId(raw: unknown): string | undefined {
  const v = typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0 ? String(raw) : raw
  return typeof v === 'string' && META_ERROR_ID.test(v) ? v : undefined
}

export function metaSessionId(raw: unknown): string | undefined {
  return typeof raw === 'string' && META_SESSION_ID.test(raw) ? raw : undefined
}

/** Not in Meta's documented ERROR shape: kept only if Meta sends one in this form. */
const META_TRACE_ID = /^[A-Za-z0-9_-]{1,128}$/
const META_TIMESTAMP = /^\d{10,16}$/
const META_PAYLOAD_KEY = /^[A-Za-z0-9_]{1,40}$/
const MAX_META_PAYLOAD_KEYS = 30
const MAX_STORED_META_TEXT = 300
const UNSAFE_META_TEXT = /[\u0000-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E\u2066-\u2069]/g
const EMAIL_LIKE = /[^\s@]+@[^\s@]+\.[^\s@]+/g
// A long unbroken run is an id or a credential, never a word in an error message.
const CREDENTIAL_LIKE = /[A-Za-z0-9_-]{32,}/g
const PHONE_LIKE = /\+?\d[\d\s().-]{5,}\d/g

export function metaTraceId(raw: unknown): string | undefined {
  return typeof raw === 'string' && META_TRACE_ID.test(raw) ? raw : undefined
}

export function metaTimestamp(raw: unknown): string | undefined {
  const v = typeof raw === 'number' && Number.isSafeInteger(raw) ? String(raw) : raw
  return typeof v === 'string' && META_TIMESTAMP.test(v) ? v : undefined
}

/** Field NAMES only, valid ones, bounded. Values are never kept. */
export function metaPayloadKeys(raw: unknown[]): string[] {
  return raw.filter((k): k is string => typeof k === 'string' && META_PAYLOAD_KEY.test(k)).slice(0, MAX_META_PAYLOAD_KEYS)
}

/**
 * Meta's error text in the form that may be stored: one bounded line, with
 * anything resembling a phone number, email or credential replaced, because the
 * customer's own details could appear in it. Empty becomes undefined.
 */
export function storableMetaErrorText(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const text = raw
    .replace(UNSAFE_META_TEXT, ' ')
    .replace(CREDENTIAL_LIKE, '[redacted]')
    .replace(EMAIL_LIKE, '[email]')
    .replace(PHONE_LIKE, '[number]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_STORED_META_TEXT)
  return text || undefined
}
