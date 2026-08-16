import { db } from '@/config/db'
import { track } from '@/lib/analytics/track'
import { GRAPH_BASE } from '@/lib/facebook/graph'
import { sealWhatsappAccessToken } from '@/lib/whatsapp/connectionToken'

/** Temporary internal test attach — agency 103 / this WABA+phone only. */
export const MANUAL_ATTACH_AGENCY_ID = 103
export const MANUAL_ATTACH_WABA_ID = '26234858992801440'
export const MANUAL_ATTACH_PHONE_NUMBER_ID = '972007939322425'
export const MANUAL_ATTACH_APP_ID = '962521689620138'
export const BLOCKED_PHONE_NUMBER_ID = '1250716944772170'
export const BLOCKED_WABA_ID = '1376927004361453'
const EXPECTED_DISPLAY_DIGITS = '972535317356'
const BLOCKED_DISPLAY_DIGITS = '972549221572'

export type AttachExistingWabaInput = {
  wabaId: string
  phoneNumberId: string
  accessToken: string
}

export type AttachExistingWabaReason =
  | 'attach_disabled'
  | 'unauthorized'
  | 'forbidden'
  | 'agency_not_allowed'
  | 'missing_fields'
  | 'blocked_phone'
  | 'blocked_waba'
  | 'waba_mismatch'
  | 'phone_mismatch'
  | 'phone_claimed'
  | 'already_connected'
  | 'graph_token'
  | 'graph_waba'
  | 'graph_phone'
  | 'phone_not_on_waba'
  | 'display_mismatch'
  | 'not_connected'
  | 'not_cloud_api'
  | 'not_subscribed'
  | 'db_error'

export type AttachExistingWabaResult = { ok: true } | { ok: false; reason: AttachExistingWabaReason }

export type AttachExistingWabaUser = {
  id: number
  agencyId: number
  role: string
}

type GraphErrorBody = { error?: { code?: number; message?: string } }

export type AttachExistingWabaDeps = {
  fetchImpl: typeof fetch
  isEnabled: () => boolean
  findByPhone: (phoneNumberId: string) => Promise<{ agency_id: number } | null>
  findByAgency: (agencyId: number) => Promise<{ id: number } | null>
  insertConnection: (row: {
    user_id: number
    agency_id: number
    phone_number_id: string
    waba_id: string
    access_token: string
    onboarding_type: 'cloud_api'
  }) => Promise<void>
  trackAttach: (agencyId: number, userId: number) => Promise<void>
}

function digits(value: string): string {
  return value.replace(/\D/g, '')
}

function isExpectedDisplay(displayPhone: string): boolean {
  const d = digits(displayPhone)
  return (
    d === EXPECTED_DISPLAY_DIGITS ||
    d === '535317356' ||
    d === '0535317356' ||
    d.endsWith(EXPECTED_DISPLAY_DIGITS)
  )
}

function isBlockedDisplay(displayPhone: string): boolean {
  const d = digits(displayPhone)
  return (
    d === BLOCKED_DISPLAY_DIGITS ||
    d === '549221572' ||
    d === '0549221572' ||
    d.endsWith(BLOCKED_DISPLAY_DIGITS)
  )
}

export function isManualAttachEnabled(flag: string | undefined = process.env.WA_MANUAL_ATTACH_ENABLED): boolean {
  return flag === '1'
}

function subscribedAppIds(payload: { data?: unknown[] } | null): string[] {
  const list = Array.isArray(payload?.data) ? payload.data : []
  const ids: string[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const rec = item as { id?: unknown; whatsapp_business_api_data?: { id?: unknown } }
    if (rec.id != null) ids.push(String(rec.id))
    if (rec.whatsapp_business_api_data?.id != null) ids.push(String(rec.whatsapp_business_api_data.id))
  }
  return ids
}

async function graphGet(
  fetchImpl: typeof fetch,
  pathAndQuery: string,
  accessToken: string,
): Promise<{ httpStatus: number; body: Record<string, unknown> }> {
  const res = await fetchImpl(`${GRAPH_BASE}/${pathAndQuery}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
  return { httpStatus: res.status, body }
}

function isTokenFailure(httpStatus: number, body: Record<string, unknown>): boolean {
  const err = body.error as GraphErrorBody['error'] | undefined
  return httpStatus === 401 || err?.code === 190
}

export async function verifyManualAttachGraph(
  input: { wabaId: string; phoneNumberId: string; accessToken: string },
  fetchImpl: typeof fetch,
): Promise<AttachExistingWabaResult> {
  const { wabaId, phoneNumberId, accessToken } = input

  let wabaRes: { httpStatus: number; body: Record<string, unknown> }
  try {
    wabaRes = await graphGet(fetchImpl, `${encodeURIComponent(wabaId)}?fields=id,name`, accessToken)
  } catch {
    return { ok: false, reason: 'graph_waba' }
  }
  if (isTokenFailure(wabaRes.httpStatus, wabaRes.body)) return { ok: false, reason: 'graph_token' }
  if (wabaRes.httpStatus >= 400 || String(wabaRes.body.id ?? '') !== wabaId) {
    return { ok: false, reason: 'graph_waba' }
  }

  let phoneRes: { httpStatus: number; body: Record<string, unknown> }
  try {
    phoneRes = await graphGet(
      fetchImpl,
      `${encodeURIComponent(phoneNumberId)}?fields=id,display_phone_number,status,platform_type`,
      accessToken,
    )
  } catch {
    return { ok: false, reason: 'graph_phone' }
  }
  if (isTokenFailure(phoneRes.httpStatus, phoneRes.body)) return { ok: false, reason: 'graph_token' }
  if (phoneRes.httpStatus >= 400 || String(phoneRes.body.id ?? '') !== phoneNumberId) {
    return { ok: false, reason: 'graph_phone' }
  }

  const display = String(phoneRes.body.display_phone_number ?? '')
  if (isBlockedDisplay(display)) return { ok: false, reason: 'blocked_phone' }
  if (!isExpectedDisplay(display)) return { ok: false, reason: 'display_mismatch' }
  if (String(phoneRes.body.status ?? '') !== 'CONNECTED') return { ok: false, reason: 'not_connected' }
  if (String(phoneRes.body.platform_type ?? '') !== 'CLOUD_API') return { ok: false, reason: 'not_cloud_api' }

  let phonesRes: { httpStatus: number; body: Record<string, unknown> }
  try {
    phonesRes = await graphGet(fetchImpl, `${encodeURIComponent(wabaId)}/phone_numbers?fields=id`, accessToken)
  } catch {
    return { ok: false, reason: 'phone_not_on_waba' }
  }
  if (isTokenFailure(phonesRes.httpStatus, phonesRes.body)) return { ok: false, reason: 'graph_token' }
  const phoneRows = Array.isArray(phonesRes.body.data) ? phonesRes.body.data : []
  const onWaba = phoneRows.some((row) => row && typeof row === 'object' && String((row as { id?: unknown }).id) === phoneNumberId)
  if (!onWaba) return { ok: false, reason: 'phone_not_on_waba' }

  let subRes: { httpStatus: number; body: Record<string, unknown> }
  try {
    subRes = await graphGet(fetchImpl, `${encodeURIComponent(wabaId)}/subscribed_apps`, accessToken)
  } catch {
    return { ok: false, reason: 'not_subscribed' }
  }
  if (isTokenFailure(subRes.httpStatus, subRes.body)) return { ok: false, reason: 'graph_token' }
  const appIds = subscribedAppIds(subRes.body as { data?: unknown[] })
  if (!appIds.includes(MANUAL_ATTACH_APP_ID)) return { ok: false, reason: 'not_subscribed' }

  return { ok: true }
}

export function createDefaultAttachDeps(): AttachExistingWabaDeps {
  return {
    fetchImpl: fetch,
    isEnabled: () => isManualAttachEnabled(),
    findByPhone: async (phoneNumberId) => {
      const row = await db('whatsapp_connections').where({ phone_number_id: phoneNumberId }).first('agency_id')
      return row ? { agency_id: Number(row.agency_id) } : null
    },
    findByAgency: async (agencyId) => {
      const row = await db('whatsapp_connections').where({ agency_id: agencyId }).first('id')
      return row ? { id: Number(row.id) } : null
    },
    insertConnection: async (row) => {
      await db('whatsapp_connections').insert(row)
    },
    trackAttach: async (agencyId, userId) => {
      await track({
        agencyId,
        userId,
        event: 'whatsapp_connected_operational',
        props: {
          source: 'manual_attach',
          wabaId: MANUAL_ATTACH_WABA_ID,
          phoneNumberId: MANUAL_ATTACH_PHONE_NUMBER_ID,
        },
      })
    },
  }
}

export async function attachExistingWabaForUser(
  user: AttachExistingWabaUser | null,
  input: AttachExistingWabaInput,
  deps: AttachExistingWabaDeps = createDefaultAttachDeps(),
): Promise<AttachExistingWabaResult> {
  if (!deps.isEnabled()) return { ok: false, reason: 'attach_disabled' }
  if (!user) return { ok: false, reason: 'unauthorized' }
  if (String(user.role) !== 'ADMIN') return { ok: false, reason: 'forbidden' }
  if (user.agencyId !== MANUAL_ATTACH_AGENCY_ID) return { ok: false, reason: 'agency_not_allowed' }

  const wabaId = String(input.wabaId ?? '').trim()
  const phoneNumberId = String(input.phoneNumberId ?? '').trim()
  const accessToken = String(input.accessToken ?? '').trim()
  if (!wabaId || !phoneNumberId || !accessToken) return { ok: false, reason: 'missing_fields' }

  if (phoneNumberId === BLOCKED_PHONE_NUMBER_ID) return { ok: false, reason: 'blocked_phone' }
  if (wabaId === BLOCKED_WABA_ID) return { ok: false, reason: 'blocked_waba' }
  if (wabaId !== MANUAL_ATTACH_WABA_ID) return { ok: false, reason: 'waba_mismatch' }
  if (phoneNumberId !== MANUAL_ATTACH_PHONE_NUMBER_ID) return { ok: false, reason: 'phone_mismatch' }

  const claimed = await deps.findByPhone(phoneNumberId)
  if (claimed) return { ok: false, reason: 'phone_claimed' }
  const existingAgency = await deps.findByAgency(user.agencyId)
  if (existingAgency) return { ok: false, reason: 'already_connected' }

  const graph = await verifyManualAttachGraph({ wabaId, phoneNumberId, accessToken }, deps.fetchImpl)
  if (graph.ok === false) return graph

  let sealed: string
  try {
    sealed = sealWhatsappAccessToken(accessToken)
  } catch {
    return { ok: false, reason: 'db_error' }
  }

  try {
    await deps.insertConnection({
      user_id: user.id,
      agency_id: user.agencyId,
      phone_number_id: phoneNumberId,
      waba_id: wabaId,
      access_token: sealed,
      onboarding_type: 'cloud_api',
    })
  } catch {
    return { ok: false, reason: 'db_error' }
  }

  await deps.trackAttach(user.agencyId, user.id)
  return { ok: true }
}
