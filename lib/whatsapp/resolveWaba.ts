import { GRAPH_BASE } from '@/lib/facebook/graph'

/**
 * Resolve the WhatsApp Business Account id(s) behind a Cloud API token.
 *
 * The WABA id is required for every template operation
 * (/{waba-id}/message_templates) but is not part of the connection row until
 * Sprint 0. This reads it from the token's granular scopes — the same technique
 * the OAuth callback already used inline, extracted here so capture (the
 * callback) and the one-off backfill share one implementation.
 *
 * Every function degrades to [] / null on any failure and never throws — the
 * caller decides how to treat "unresolved" (the routes fail the flow; the
 * backfill leaves waba_id null to retry).
 */

type GranularScope = { scope: string; target_ids?: string[] }

export async function resolveWabaIdsFromToken(
  token: string,
  appId: string | undefined = process.env.META_APP_ID,
  appSecret: string | undefined = process.env.META_APP_SECRET,
): Promise<string[]> {
  if (!token || !appId || !appSecret) return []
  try {
    const appToken = `${appId}|${appSecret}`
    const res = await fetch(
      `${GRAPH_BASE}/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(appToken)}`,
    )
    if (!res.ok) return []
    const data = await res.json()
    const granular: GranularScope[] = data?.data?.granular_scopes ?? []
    const targetsFor = (scope: string) => granular.find((g) => g.scope === scope)?.target_ids ?? []
    // Prefer the management scope (template CRUD lives there); fall back to
    // messaging so a token with only the messaging scope still resolves.
    const ids = new Set<string>(targetsFor('whatsapp_business_management'))
    if (ids.size === 0) for (const id of targetsFor('whatsapp_business_messaging')) ids.add(id)
    return [...ids]
  } catch {
    return []
  }
}

/**
 * The single WABA that owns `phoneNumberId`. When the token manages exactly one
 * WABA that is the answer; otherwise disambiguate by listing each WABA's phone
 * numbers. Returns null when it cannot be resolved.
 */
export async function resolveWabaForPhone(
  token: string,
  phoneNumberId: string,
  appId?: string,
  appSecret?: string,
): Promise<string | null> {
  const ids = await resolveWabaIdsFromToken(token, appId, appSecret)
  if (ids.length === 0) return null
  if (ids.length === 1) return ids[0]
  for (const wabaId of ids) {
    try {
      const res = await fetch(
        `${GRAPH_BASE}/${wabaId}/phone_numbers?fields=id&access_token=${encodeURIComponent(token)}`,
      )
      if (!res.ok) continue
      const data = await res.json()
      if ((data?.data ?? []).some((p: { id: string }) => p.id === phoneNumberId)) return wabaId
    } catch {
      continue
    }
  }
  return null
}
