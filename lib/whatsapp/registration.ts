import { randomInt } from 'crypto'
import { GRAPH_BASE } from '@/lib/facebook/graph'
import { fetchPhoneBizAppState } from '@/lib/whatsapp/coexistence'

export type MessagingReadiness = {
  ready: boolean
  status?: string
  reason?: string
}

type PhoneStatus = {
  status?: string
  codeVerificationStatus?: string
  platformType?: string
}

const CONNECTED = 'CONNECTED'
const FETCH_TIMEOUT_MS = 6000

function generatePin(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0')
}

async function fetchWithTimeout(url: string, options?: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

export async function getPhoneStatus(phoneNumberId: string, accessToken: string): Promise<PhoneStatus> {
  const res = await fetchWithTimeout(
    `${GRAPH_BASE}/${phoneNumberId}?fields=status,code_verification_status,platform_type&access_token=${accessToken}`,
  )
  const data = (await res.json().catch(() => ({}))) as {
    status?: string
    code_verification_status?: string
    platform_type?: string
  }
  return {
    status: data.status,
    codeVerificationStatus: data.code_verification_status,
    platformType: data.platform_type,
  }
}

async function registerPhoneNumber(
  phoneNumberId: string,
  accessToken: string,
  pin: string,
): Promise<{ success: boolean; error?: string }> {
  const res = await fetchWithTimeout(`${GRAPH_BASE}/${phoneNumberId}/register`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', pin }),
  })
  const data = (await res.json().catch(() => ({}))) as { success?: boolean; error?: { message?: string } }
  if (res.ok && data?.success) return { success: true }
  return { success: false, error: data?.error?.message || `HTTP ${res.status}` }
}

export type PhoneStatusProbe =
  | { ok: true; status?: string; codeVerificationStatus?: string; platformType?: string }
  | { ok: false; kind: 'token' | 'throttled' | 'error' | 'timeout'; httpStatus?: number }

export type SubscribedAppsProbe =
  | { ok: true; subscribed: boolean }
  | { ok: false; kind: 'token' | 'throttled' | 'error' | 'timeout'; httpStatus?: number }

type GraphErrorBody = { error?: { code?: number }; status?: string; code_verification_status?: string; platform_type?: string; data?: unknown[] }

/**
 * Meta's WABA-level rate limit.
 *
 * `#80008` — "There have been too many calls to this WhatsApp Business account"
 * — arrives as HTTP 400 with an `OAuthException` type, so both the status code
 * and the type invite the wrong conclusion. It says nothing about the
 * credential: the token is fine, the account is simply being throttled, and the
 * condition clears on its own.
 *
 * It had been landing in the generic `'error'` bucket, which the health resolver
 * turns into `unknown`, which tells the customer their connection needs
 * re-verification and blocks the composer. Every part of that is false, and the
 * suggested cure — reconnect — spends more calls against the account that is
 * already over its limit.
 */
const RATE_LIMIT_CODE = 80008

function classifyGraphFailure(
  res: Response,
  data: GraphErrorBody,
): 'token' | 'throttled' | 'error' | null {
  // Checked FIRST and on its own terms: a genuine auth failure must never be
  // mistaken for a throttle, so 401/190 keeps priority over everything below.
  if (res.status === 401 || data.error?.code === 190) return 'token'
  if (data.error?.code === RATE_LIMIT_CODE) return 'throttled'
  if (!res.ok) return 'error'
  return null
}

/** Structured phone-status probe. Distinguishes token (401/190) from not-CONNECTED. */
export async function probePhoneStatus(phoneNumberId: string, accessToken: string): Promise<PhoneStatusProbe> {
  try {
    const res = await fetchWithTimeout(
      `${GRAPH_BASE}/${phoneNumberId}?fields=status,code_verification_status,platform_type&access_token=${accessToken}`,
    )
    const data = (await res.json().catch(() => ({}))) as GraphErrorBody
    const fail = classifyGraphFailure(res, data)
    if (fail === 'token') return { ok: false, kind: 'token', httpStatus: res.status }
    if (fail === 'throttled') return { ok: false, kind: 'throttled', httpStatus: res.status }
    if (fail === 'error') return { ok: false, kind: 'error', httpStatus: res.status }
    return {
      ok: true,
      status: data.status,
      codeVerificationStatus: data.code_verification_status,
      platformType: data.platform_type,
    }
  } catch {
    return { ok: false, kind: 'timeout' }
  }
}

/** Structured subscribed_apps probe. Distinguishes token (401/190) from empty list. */
export async function probeAppSubscribed(wabaId: string, accessToken: string): Promise<SubscribedAppsProbe> {
  try {
    const res = await fetchWithTimeout(`${GRAPH_BASE}/${wabaId}/subscribed_apps?access_token=${accessToken}`)
    const data = (await res.json().catch(() => ({}))) as GraphErrorBody
    const fail = classifyGraphFailure(res, data)
    if (fail === 'token') return { ok: false, kind: 'token', httpStatus: res.status }
    if (fail === 'throttled') return { ok: false, kind: 'throttled', httpStatus: res.status }
    if (fail === 'error') return { ok: false, kind: 'error', httpStatus: res.status }
    return { ok: true, subscribed: Array.isArray(data.data) && data.data.length > 0 }
  } catch {
    return { ok: false, kind: 'timeout' }
  }
}

export async function checkMessagingReady(phoneNumberId: string, accessToken: string): Promise<boolean> {
  try {
    const s = await getPhoneStatus(phoneNumberId, accessToken)
    return s.status === CONNECTED
  } catch {
    return false
  }
}

/**
 * Whether OUR app is subscribed to the WABA's webhooks — i.e. whether inbound
 * messages/leads can actually reach us. A non-empty subscribed_apps list means
 * an app subscription exists (this token can only see its own app's). Read-only.
 * Returns false on any error (safe: "cannot prove subscribed").
 */
export async function checkAppSubscribed(wabaId: string, accessToken: string): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(`${GRAPH_BASE}/${wabaId}/subscribed_apps?access_token=${accessToken}`)
    if (!res.ok) return false
    const data = (await res.json().catch(() => ({}))) as { data?: unknown[] }
    return Array.isArray(data.data) && data.data.length > 0
  } catch {
    return false
  }
}

export type EnsureMessagingOptions = {
  /**
   * Coexistence numbers are already registered by Meta during Embedded Signup.
   * Meta: "use them to onboard the customer as you normally would, but skip the
   * phone number registration step, as the number is already registered."
   *
   * Calling /register against a number that is live on the WhatsApp Business app
   * is not a harmless retry — registration is how a number is claimed for Cloud
   * API, which is exactly what coexistence exists to avoid.
   */
  skipRegistration?: boolean
}

export async function ensureMessagingReady(
  phoneNumberId: string,
  accessToken: string,
  options: EnsureMessagingOptions = {},
): Promise<MessagingReadiness> {
  let status: PhoneStatus
  try {
    status = await getPhoneStatus(phoneNumberId, accessToken)
  } catch (e) {
    console.error('[WA Registration] status probe failed:', e)
    return { ready: false, reason: 'status_probe_failed' }
  }

  if (status.status === CONNECTED) return { ready: true, status: status.status }

  if (options.skipRegistration) {
    // Not an error: Meta may still be finishing setup. The settings UI shows an
    // honest "setup incomplete" rather than a false green, and the number
    // becomes ready without us ever registering it.
    console.warn('[WA Registration] coexistence number not yet CONNECTED; registration deliberately skipped', {
      phoneNumberId,
      status: status.status,
      platformType: status.platformType,
    })
    return { ready: false, status: status.status, reason: 'coexistence_pending' }
  }

  // Hard lock: Graph `is_on_biz_app === true` must never reach POST /register,
  // even if the caller forgot skipRegistration or the browser claimed cloud_api.
  // The browser-supplied onboardingType is not the authority for this decision.
  const bizApp = await fetchPhoneBizAppState(phoneNumberId, accessToken)
  if (bizApp.isOnBizApp) {
    console.warn('[WA Registration] is_on_biz_app=true; registration refused', {
      phoneNumberId,
      status: status.status,
      platformType: bizApp.platformType,
    })
    return { ready: false, status: status.status, reason: 'coexistence_pending' }
  }
  // Fail closed: if Meta did not say whether the number is on the WhatsApp
  // Business app, do not register it. A Cloud API number stays "setup not
  // complete" until the customer reconnects; a Business app number is never
  // claimed for Cloud API on a guess.
  if (!bizApp.known) {
    console.warn('[WA Registration] is_on_biz_app unknown; registration deferred', {
      phoneNumberId,
      status: status.status,
    })
    return { ready: false, status: status.status, reason: 'biz_app_status_unknown' }
  }

  const reg = await registerPhoneNumber(phoneNumberId, accessToken, generatePin())
  if (reg.success) return { ready: true, status: CONNECTED }

  const after = await getPhoneStatus(phoneNumberId, accessToken).catch(() => status)
  if (after.status === CONNECTED) return { ready: true, status: after.status }

  console.warn('[WA Registration] number not messaging-ready:', { phoneNumberId, status: after.status, error: reg.error })
  return { ready: false, status: after.status, reason: reg.error || 'registration_required' }
}
