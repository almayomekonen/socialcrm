import { randomInt } from 'crypto'
import { GRAPH_BASE } from '@/lib/facebook/graph'

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

export async function checkMessagingReady(phoneNumberId: string, accessToken: string): Promise<boolean> {
  try {
    const s = await getPhoneStatus(phoneNumberId, accessToken)
    return s.status === CONNECTED
  } catch {
    return false
  }
}

export async function ensureMessagingReady(phoneNumberId: string, accessToken: string): Promise<MessagingReadiness> {
  let status: PhoneStatus
  try {
    status = await getPhoneStatus(phoneNumberId, accessToken)
  } catch (e) {
    console.error('[WA Registration] status probe failed:', e)
    return { ready: false, reason: 'status_probe_failed' }
  }

  if (status.status === CONNECTED) return { ready: true, status: status.status }

  const reg = await registerPhoneNumber(phoneNumberId, accessToken, generatePin())
  if (reg.success) return { ready: true, status: CONNECTED }

  const after = await getPhoneStatus(phoneNumberId, accessToken).catch(() => status)
  if (after.status === CONNECTED) return { ready: true, status: after.status }

  console.warn('[WA Registration] number not messaging-ready:', { phoneNumberId, status: after.status, error: reg.error })
  return { ready: false, status: after.status, reason: reg.error || 'registration_required' }
}
