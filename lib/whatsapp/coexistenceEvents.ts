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
