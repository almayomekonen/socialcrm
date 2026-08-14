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
 * `smb_app_data` postdates the app-wide Graph version (v19.0), so this one
 * feature pins its own. Deliberately NOT a global bump — GRAPH_VERSION is used
 * by message sending, template sync, health checks and the Conversions API, and
 * moving all of those is a separate change with its own blast radius.
 */
export const COEXISTENCE_GRAPH_VERSION = process.env.META_COEXISTENCE_GRAPH_VERSION || 'v25.0'
const COEXISTENCE_GRAPH_BASE = `https://graph.facebook.com/${COEXISTENCE_GRAPH_VERSION}`

/** Which Embedded Signup flow the customer actually completed. */
export type OnboardingType = 'cloud_api' | 'coexistence'

/**
 * Embedded Signup completion events. Meta emits a distinct event for the
 * Business app flow, so the two are told apart at the source rather than
 * guessed at later.
 */
export const ES_EVENT_FINISH = 'FINISH'
export const ES_EVENT_FINISH_COEXISTENCE = 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING'

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
 * Entry point for coexistence webhook fields. They reach this pipeline and
 * are acknowledged; they must never be treated as inbound customer messages.
 */
export function processCoexistenceWebhook(field: string, _value: unknown): { ok: true; field: string } {
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
 * Never throws: a failed lookup returns isOnBizApp false so Cloud API
 * onboarding is not blocked by a metadata blip. The hard lock against
 * /register is `isOnBizApp === true`, not "lookup failed".
 */
export async function fetchPhoneBizAppState(phoneNumberId: string, accessToken: string): Promise<PhoneBizAppState> {
  try {
    const res = await fetch(
      `${COEXISTENCE_GRAPH_BASE}/${encodeURIComponent(phoneNumberId)}?fields=is_on_biz_app,platform_type&access_token=${encodeURIComponent(accessToken)}`,
    )
    if (!res.ok) {
      console.error('[WA Coexistence] phone biz-app lookup failed:', res.status)
      return { isOnBizApp: false }
    }
    const data = (await res.json().catch(() => ({}))) as { is_on_biz_app?: boolean; platform_type?: string }
    return { isOnBizApp: data.is_on_biz_app === true, platformType: data.platform_type }
  } catch (e) {
    console.error('[WA Coexistence] phone biz-app lookup threw:', e)
    return { isOnBizApp: false }
  }
}

/**
 * Graph `is_on_biz_app` wins over the browser-supplied type. The browser hint
 * is kept only for the window where Meta has completed Embedded Signup but
 * has not yet flipped the flag — still skip /register in that case.
 */
export function resolveOnboardingType(args: { isOnBizApp: boolean; browserOnboardingType?: OnboardingType }): OnboardingType {
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

export type SmbSyncResult = {
  contacts: boolean
  history: boolean
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
 * Never throws. A failed sync degrades the connection (no imported history);
 * it must not fail an otherwise good onboarding.
 */
export async function syncSmbAppData(phoneNumberId: string, accessToken: string): Promise<SmbSyncResult> {
  const contacts = await postSmbAppData(phoneNumberId, accessToken, 'smb_app_state_sync')
  if (!contacts) return { contacts: false, history: false }

  const history = await postSmbAppData(phoneNumberId, accessToken, 'history')
  return { contacts, history }
}
