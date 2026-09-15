import { GRAPH_BASE } from '@/lib/facebook/graph'
import { MESSENGER_WEBHOOK_FIELDS } from '@/lib/facebook/pageWebhookFields'

/**
 * The APP half of Messenger delivery: Meta dashboard → Webhooks → Page.
 *
 * A Page subscribed to `messages` still receives nothing when the app's own Page
 * subscription lacks the field — the first of the two causes of the 2026-09-14
 * incident. No customer can change the dashboard, so this feeds an operator log
 * (healthSweep), never a customer notice.
 *
 * Read with the app token in the Authorization header. Returns the Messenger
 * fields the app is missing, or null when the answer could not be read.
 */
export async function missingAppMessengerFields(fetchImpl: typeof fetch = fetch): Promise<string[] | null> {
  const appId = process.env.META_APP_ID?.trim()
  const appSecret = process.env.META_APP_SECRET
  if (!appId || !appSecret) return null
  try {
    const res = await fetchImpl(`${GRAPH_BASE}/${encodeURIComponent(appId)}/subscriptions`, {
      headers: { Authorization: `Bearer ${appId}|${appSecret}` },
      signal: AbortSignal.timeout(6_000),
    })
    const data = (await res.json().catch(() => null)) as { data?: unknown } | null
    if (!res.ok || !Array.isArray(data?.data)) return null
    const page = (data.data as { object?: unknown; fields?: unknown }[]).find((s) => s?.object === 'page')
    const have = new Set(
      (Array.isArray(page?.fields) ? page.fields : []).map((f) => (f as { name?: unknown })?.name),
    )
    return MESSENGER_WEBHOOK_FIELDS.filter((f) => !have.has(f))
  } catch {
    return null
  }
}
