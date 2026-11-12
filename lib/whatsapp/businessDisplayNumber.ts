import { GRAPH_BASE } from '@/lib/facebook/graph'

/**
 * The business's own WhatsApp number (Meta's `display_phone_number`) for one
 * connected `phone_number_id`, digits only. One read-only Graph call, the same
 * field attachExistingWaba.ts reads; `whatsapp_connections` does not store it.
 * Null on any failure: a caller that needs the number must then not proceed.
 */

const TIMEOUT_MS = 5_000

export async function fetchBusinessDisplayNumber(phoneNumberId: string, accessToken: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  try {
    const res = await fetchImpl(`${GRAPH_BASE}/${encodeURIComponent(phoneNumberId)}?fields=id,display_phone_number`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) return null
    const body = (await res.json()) as { id?: unknown; display_phone_number?: unknown }
    if (String(body.id ?? '') !== phoneNumberId) return null
    const digits = String(body.display_phone_number ?? '').replace(/\D/g, '')
    return digits.length >= 8 && digits.length <= 15 ? digits : null
  } catch {
    return null
  }
}
