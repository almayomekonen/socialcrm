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

/** Which flavour of onboarding the browser reported completing. */
export type OnboardingType = 'cloud_api' | 'coexistence'

/** Meta's event when the customer leaves the flow early or reports an error in it. */
export const ES_EVENT_CANCEL = 'CANCEL'

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
