import { GRAPH_BASE } from '@/lib/facebook/graph'
import { appSecretProof, parseGraphError, type MetaGraphError } from '@/lib/facebook/graphClient'
import type { MessengerSendableType } from '@/lib/facebook/messenger/attachmentRules'

/**
 * POST /{PAGE-ID}/messages as multipart/form-data — one media reply.
 *
 * WHY MULTIPART AND NOT A URL. Meta's other route is `payload.url`, which
 * requires the file to be publicly reachable first. SocialCRM has no public
 * blob host for customer media, and standing one up would mean every attachment
 * a rep sends becomes an unauthenticated public URL for as long as it exists.
 * Streaming the bytes to Meta keeps the file off our infrastructure entirely:
 * browser → server → Meta, nothing stored, nothing to leak.
 *
 * Format per https://developers.facebook.com/docs/messenger-platform/send-messages/saving-assets
 * (checked 2026-09-23): `recipient`, `message` and `filedata` form fields.
 *
 * TOKEN HYGIENE matches graphClient: Bearer header (never the querystring, so it
 * cannot reach an access log) plus `appsecret_proof`. This cannot go through
 * `graphRequest`, which is JSON-only — so the two rules it exists to enforce are
 * restated here rather than bypassed.
 *
 * `is_reusable` is deliberately FALSE: a reusable attachment_id is a durable
 * handle to a customer's file living on Meta's side with no expiry we control,
 * and nothing in SocialCRM re-sends the same asset.
 *
 * NEVER THROWS for a Meta or network failure — returns a typed error, exactly
 * like graphRequest, so the caller can map it to a reason the rep can act on.
 */
export async function sendMessengerAttachment(input: {
  pageId: string
  pageAccessToken: string
  psid: string
  type: MessengerSendableType
  file: Blob
  filename: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
}): Promise<{ ok: true; mid: string } | { ok: false; error: MetaGraphError }> {
  const form = new FormData()
  form.set('recipient', JSON.stringify({ id: input.psid }))
  form.set('messaging_type', 'RESPONSE')
  form.set('message', JSON.stringify({ attachment: { type: input.type, payload: { is_reusable: false } } }))
  // The filename Meta shows the customer. Path separators and control characters
  // are stripped so a crafted name cannot alter the multipart headers.
  const safeName = (input.filename || 'file').replace(/[\r\n"\\/\u0000-\u001f]/g, '_').slice(0, 120)
  form.set('filedata', input.file, safeName)

  const params = new URLSearchParams()
  const proof = appSecretProof(input.pageAccessToken)
  if (proof) params.set('appsecret_proof', proof)
  const qs = params.toString()
  const url = `${GRAPH_BASE}/${encodeURIComponent(input.pageId)}/messages${qs ? `?${qs}` : ''}`

  const controller = new AbortController()
  // Media is slower than text; a 25 MB upload on a phone needs more than the
  // 8s JSON default.
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 60_000)

  let res: Response
  try {
    res = await (input.fetchImpl ?? fetch)(url, {
      method: 'POST',
      // No Content-Type header: fetch must set the multipart boundary itself.
      headers: { Authorization: `Bearer ${input.pageAccessToken}` },
      body: form,
      signal: controller.signal,
      cache: 'no-store',
    })
  } catch (err) {
    const timeout = (err as { name?: string })?.name === 'AbortError'
    return {
      ok: false,
      error: { kind: timeout ? 'timeout' : 'network', status: 0, code: null, subcode: null, type: null, message: null },
    }
  } finally {
    clearTimeout(timer)
  }

  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    body = null
  }
  if (!res.ok || (body as { error?: unknown } | null)?.error) {
    return { ok: false, error: parseGraphError(res.status, body) }
  }

  const mid = (body as { message_id?: unknown } | null)?.message_id
  if (typeof mid !== 'string' || !mid) {
    return {
      ok: false,
      error: { kind: 'invalid_response', status: res.status, code: null, subcode: null, type: null, message: null },
    }
  }
  return { ok: true, mid }
}
