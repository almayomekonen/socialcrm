/**
 * WhatsApp Business App Coexistence.
 *
 * Coexistence lets a business keep using the WhatsApp Business app on their
 * phone while the same number is connected to Cloud API. Without it, Meta only
 * offers the destructive path: "To use an existing WhatsApp Business app phone
 * number with Cloud API, you must either delete your account, or onboard to the
 * platform using a solution provider who supports business app number
 * onboarding." Customers refused to delete their app, so they abandoned setup.
 *
 * This module holds the pieces that are specific to that flow. Everything here
 * is additive: a normal Cloud API onboarding never reaches it.
 *
 * Server-side Graph metadata (`is_on_biz_app`) is the authority for whether a
 * number is on the WhatsApp Business app. The browser-supplied onboardingType
 * is only a hint for the window before Meta flips that flag.
 */

/**
 * SERVER ONLY. This module ingests webhooks, writes to Postgres and reads the
 * session; none of it may reach the browser. The marker is not decoration — it
 * is what stops the Client Component graph from silently re-acquiring
 * `db/auth.ts` and `config/db.ts` the next time something imports a constant
 * from here, which is exactly how the production build broke.
 *
 * The Embedded Signup event constants the browser DOES need live in
 * `lib/whatsapp/coexistenceEvents.ts` and are re-exported below, so every
 * server caller keeps importing them from here unchanged.
 */
import 'server-only'
import type { OnboardingType } from '@/lib/whatsapp/coexistenceEvents'
import { ingestWhatsappEchoes } from '@/lib/inbox/ingestWhatsappEcho'
import { receiveHistoryWebhook } from '@/lib/inbox/history/receiveHistory'
import { isHistoryEnabledForPhoneNumber, historyActivationState } from '@/lib/whatsapp/historyFlags'

/**
 * `smb_app_data` postdates the app-wide Graph version (v19.0), so this one
 * feature pins its own. Deliberately NOT a global bump — GRAPH_VERSION is used
 * by message sending, template sync, health checks and the Conversions API, and
 * moving all of those is a separate change with its own blast radius.
 */
export const COEXISTENCE_GRAPH_VERSION = process.env.META_COEXISTENCE_GRAPH_VERSION || 'v25.0'
const COEXISTENCE_GRAPH_BASE = `https://graph.facebook.com/${COEXISTENCE_GRAPH_VERSION}`

/** Which Embedded Signup flow the customer actually completed. */
export type { OnboardingType } from '@/lib/whatsapp/coexistenceEvents'

/**
 * Embedded Signup completion events. Meta emits a distinct event for the
 * Business app flow, so the two are told apart at the source rather than
 * guessed at later.
 */
export { ES_EVENT_FINISH, ES_EVENT_FINISH_COEXISTENCE } from '@/lib/whatsapp/coexistenceEvents'

/**
 * Webhook fields that coexistence adds. They are NOT inbound customer messages
 * and must never reach lead creation or the auto-response worker:
 *
 *  - `smb_message_echoes`  messages the BUSINESS sent from their own phone.
 *                          Treating one as inbound would create a lead from the
 *                          business's own message and could fire an automated
 *                          reply at a real customer.
 *  - `history`             past conversations replayed after onboarding.
 *  - `smb_app_state_sync`  the customer's contact list.
 *
 * Their payloads live under `message_echoes` / `history` / `state_sync`, not
 * `messages`, so the existing reader would not pick them up either — this is
 * the explicit second lock, not the only one.
 */
const COEXISTENCE_WEBHOOK_FIELDS = new Set(['smb_message_echoes', 'history', 'smb_app_state_sync'])

export function isCoexistenceWebhookField(field: unknown): boolean {
  return typeof field === 'string' && COEXISTENCE_WEBHOOK_FIELDS.has(field)
}

/**
 * Entry point for coexistence webhook fields. They reach this pipeline and are
 * acknowledged; they must never be treated as inbound customer messages.
 *
 * `smb_message_echoes` is now PERSISTED (Wave 2A.1) — as OUTBOUND, through a
 * dedicated path that shares the inbox persistence primitives and executes none
 * of the inbound side effects. Everything the original guard was protecting
 * against still holds: an echo cannot create a lead, cannot enqueue an
 * auto-response, and cannot be read as a customer message.
 *
 * `history` and `smb_app_state_sync` remain acknowledged and unread. History is
 * additionally not even REQUESTED — see `HISTORY_SYNC_ENABLED`, which this wave
 * does not touch. Persisting echoes is deliberately independent of the history
 * importer: echoes are live traffic arriving continuously, history is a
 * one-time archive, and fixing the former does not require the latter.
 */
export async function processCoexistenceWebhook(
  field: string,
  value: unknown,
): Promise<{ ok: boolean; field: string; reason?: string }> {
  if (field === 'smb_message_echoes') {
    // Never throws — the webhook must answer 200 regardless.
    await ingestWhatsappEchoes(value)
    return { ok: true, field }
  }

  if (field === 'history') {
    /**
     * THE GATE IS THE REACHABILITY BOUNDARY, and it is checked here because this
     * file owns the constant. While `HISTORY_SYNC_ENABLED` is false the importer
     * is unreachable from production by construction — not by configuration, not
     * by a feature flag someone can flip in a dashboard, but by a branch that
     * cannot be taken. Wave 2A.2d built the durable receive, the queue and the
     * worker behind it; none of it can run until this constant changes in a diff.
     *
     * It is also consistent: history is not being REQUESTED either, so in
     * production this branch has nothing to receive. The archive stays unspent
     * at Meta, which is the entire point of Wave 2A.0.
     */
    if (HISTORY_SYNC_ENABLED) {
      // Fast path only: one tenant lookup, one durable insert, then 200. The
      // archive is imported later by the worker, never inside this request.
      const received = await receiveHistoryWebhook(value)
      // THE ONLY UNACKNOWLEDGED OUTCOME (F-2). A delivery is acknowledged once
      // it is durably stored — or proven to be one we already hold. If the write
      // failed, this refuses to say 200, because Meta redelivers only on a
      // non-2xx and the archive cannot be requested a second time.
      if (received.outcome === 'failed') {
        return { ok: false, field, reason: 'history_durable_write_failed' }
      }
    }
    return { ok: true, field }
  }

  console.log('[WhatsappWebhook][coexistence] processed; never treated as inbound', { field })
  return { ok: true, field }
}

type PhoneNumberRow = {
  id?: string
  display_phone_number?: string
  platform_type?: string
  is_on_biz_app?: boolean
}

/**
 * Flat rather than a discriminated union on purpose: this codebase compiles
 * with `strictNullChecks: false`, where narrowing on a boolean discriminant
 * does not work. Success is "phoneNumberId is present".
 */
export type PhoneResolution = {
  phoneNumberId?: string
  reason?: 'none_found' | 'ambiguous' | 'lookup_failed'
}

export type PhoneBizAppState = {
  isOnBizApp: boolean
  /** Meta answered `is_on_biz_app`. False = unknown: the number may be on the Business app. */
  known: boolean
  platformType?: string
}

/**
 * Server-side authority for Coexistence vs Cloud API.
 *
 * Meta: GET /{phone_number_id}?fields=is_on_biz_app,platform_type
 * If `is_on_biz_app` is true, the number is live on the WhatsApp Business app
 * and MUST NOT be passed to POST /register.
 *
 * Uses the coexistence Graph version because `is_on_biz_app` postdates v19.0.
 * Never throws. A failed lookup is `known: false`: the connection is still
 * saved, but registration must not run (see ensureMessagingReady).
 */
export async function fetchPhoneBizAppState(phoneNumberId: string, accessToken: string): Promise<PhoneBizAppState> {
  try {
    const res = await fetch(
      `${COEXISTENCE_GRAPH_BASE}/${encodeURIComponent(phoneNumberId)}?fields=is_on_biz_app,platform_type&access_token=${encodeURIComponent(accessToken)}`,
    )
    if (!res.ok) {
      console.error('[WA Coexistence] phone biz-app lookup failed:', res.status)
      return { isOnBizApp: false, known: false }
    }
    const data = (await res.json().catch(() => ({}))) as { is_on_biz_app?: unknown; platform_type?: string }
    const known = typeof data.is_on_biz_app === 'boolean'
    if (!known) console.error('[WA Coexistence] phone biz-app lookup returned no is_on_biz_app')
    return { isOnBizApp: data.is_on_biz_app === true, known, platformType: data.platform_type }
  } catch (e) {
    console.error('[WA Coexistence] phone biz-app lookup threw:', e)
    return { isOnBizApp: false, known: false }
  }
}

/**
 * Graph `is_on_biz_app` wins over the browser-supplied type. The browser hint
 * is kept only for the window where Meta has completed Embedded Signup but
 * has not yet flipped the flag — still skip /register in that case.
 * An existing Coexistence connection stays Coexistence on reconnect, whatever
 * Meta or the browser say: leaving Coexistence is never automatic.
 */
export function resolveOnboardingType(args: {
  isOnBizApp: boolean
  browserOnboardingType?: OnboardingType
  existingOnboardingType?: string | null
}): OnboardingType {
  if (args.existingOnboardingType === 'coexistence') return 'coexistence'
  if (args.isOnBizApp) return 'coexistence'
  return args.browserOnboardingType === 'coexistence' ? 'coexistence' : 'cloud_api'
}

/**
 * Resolve the business phone number id from a WABA id.
 *
 * Meta documents `waba_id` on the coexistence completion event; whether
 * `phone_number_id` accompanies it is not guaranteed. Production previously
 * rejected the whole onboarding when the id was absent, so a customer who
 * completed Meta's flow correctly still ended up unconnected.
 *
 * A WABA can contain several numbers. When exactly one of them has
 * `is_on_biz_app === true`, that is the Coexistence number — do not treat
 * the whole list as ambiguous. Remaining multi-number cases still fail
 * rather than guess: picking the wrong number would silently wire the CRM
 * to a phone the business does not use for leads.
 */
export async function resolvePhoneNumberIdForWaba(wabaId: string, accessToken: string): Promise<PhoneResolution> {
  try {
    const res = await fetch(
      `${COEXISTENCE_GRAPH_BASE}/${encodeURIComponent(wabaId)}/phone_numbers?fields=id,display_phone_number,platform_type,is_on_biz_app&access_token=${encodeURIComponent(accessToken)}`,
    )
    if (!res.ok) {
      console.error('[WA Coexistence] phone_numbers lookup failed:', res.status)
      return { reason: 'lookup_failed' }
    }
    const body = (await res.json().catch(() => ({}))) as { data?: PhoneNumberRow[] }
    const rows = (body.data ?? []).filter((r): r is PhoneNumberRow & { id: string } => Boolean(r?.id))

    if (rows.length === 0) return { reason: 'none_found' }
    if (rows.length === 1) return { phoneNumberId: rows[0].id }

    const onBizApp = rows.filter((r) => r.is_on_biz_app === true)
    if (onBizApp.length === 1) return { phoneNumberId: onBizApp[0].id }
    return { reason: 'ambiguous' }
  } catch (e) {
    console.error('[WA Coexistence] phone_numbers lookup threw:', e)
    return { reason: 'lookup_failed' }
  }
}

/**
 * WAVE 2A.0 — THE HISTORY GATE.
 *
 * History sync is temporarily disabled because the webhook currently DISCARDS
 * the one-time archive. It must remain disabled until the history importer is
 * implemented and verified.
 *
 * Why this is a data-loss guard rather than a feature flag. Meta's history sync
 * is one-time and non-repeatable: "You can only perform this step once. If you
 * need to perform it again, the customer must first offboard, then complete the
 * Embedded Signup flow again." Today `processCoexistenceWebhook` acknowledges
 * the `history` field and reads nothing from it, so every request made here
 * spends a customer's entire prior WhatsApp archive and throws it away —
 * permanently, and with no way to ask again.
 *
 * Not requesting it PRESERVES the archive. Meta holds it until asked; the
 * importer can request it later and receive the same replay.
 *
 * DELIBERATELY A CONSTANT, NOT AN ENV FLAG. An environment variable can be
 * flipped in a dashboard by someone who does not know the importer is missing,
 * and the damage is irreversible per customer. Lifting this gate must be a code
 * change that appears in a diff and is reviewed alongside the importer that
 * makes it safe.
 *
 * TO LIFT: implement + verify the history importer, then set this to `true` in
 * the same change. Nothing else here needs to move — the webhook routing and the
 * `history` field handler are untouched and already able to receive the replay.
 */
export const HISTORY_SYNC_ENABLED = true

export type SmbSyncResult = {
  contacts: boolean
  /** True only when Meta accepted a history request. False when it failed OR was never asked. */
  history: boolean
  /**
   * Whether history was REQUESTED at all. Distinguishes the deliberate gate
   * above from a genuine failure, so a caller cannot misreport "sync incomplete"
   * for a request that was intentionally never made.
   */
  historyRequested: boolean
}

async function postSmbAppData(phoneNumberId: string, accessToken: string, syncType: string): Promise<boolean> {
  try {
    const res = await fetch(`${COEXISTENCE_GRAPH_BASE}/${phoneNumberId}/smb_app_data`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', sync_type: syncType }),
    })
    if (!res.ok) {
      console.error('[WA Coexistence] smb_app_data failed', { syncType, status: res.status })
      return false
    }
    return true
  } catch (e) {
    console.error('[WA Coexistence] smb_app_data threw', { syncType, error: String(e) })
    return false
  }
}

/**
 * Request the one-time contact and message-history sync for a freshly onboarded
 * coexistence number.
 *
 * Meta: "You have 24 hours to synchronize their contacts and messaging history,
 * otherwise they must be offboarded", and "You can only perform this step once.
 * If you need to perform it again, the customer must first offboard, then
 * complete the Embedded Signup flow again."
 *
 * Order is load-bearing: contacts must be requested before history. History is
 * only attempted if contacts succeeded, because requesting history against a
 * failed contact sync burns the one allowed attempt.
 *
 * HISTORY IS CURRENTLY GATED OFF — see `HISTORY_SYNC_ENABLED`. Contacts are
 * unaffected and still requested exactly as before: the two are independent
 * calls, and the contact list is consumed by nothing today either but costs
 * nothing to hold, whereas history is destroyed by being asked for.
 *
 * Never throws. A failed sync degrades the connection (no imported history);
 * it must not fail an otherwise good onboarding.
 */
export async function syncSmbAppData(phoneNumberId: string, accessToken: string): Promise<SmbSyncResult> {
  const contacts = await postSmbAppData(phoneNumberId, accessToken, 'smb_app_state_sync')
  if (!contacts) return { contacts: false, history: false, historyRequested: false }

  // BOTH KEYS. The constant is the reviewed one; the allowlist is the narrow
  // one. Requesting history SPENDS the archive irreversibly, so this is the
  // single most consequential branch in the feature — and it is deny-by-default
  // twice over.
  if (!HISTORY_SYNC_ENABLED || !isHistoryEnabledForPhoneNumber(phoneNumberId)) {
    // The archive is left with Meta, unrequested and therefore unspent, so the
    // future importer can still claim it. This is the whole point of the gate.
    console.log('[WA Coexistence] history sync gated off; archive preserved for the importer', {
      phoneNumberId,
      ...historyActivationState(),
    })
    return { contacts, history: false, historyRequested: false }
  }

  const history = await postSmbAppData(phoneNumberId, accessToken, 'history')
  return { contacts, history, historyRequested: true }
}
