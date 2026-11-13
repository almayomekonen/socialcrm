import { GRAPH_BASE } from '@/lib/facebook/graph'
import { VOICE_DOWNLOAD_TIMEOUT_MS, VOICE_NOTE_MAX_BYTES } from './voiceNote'

/**
 * Fetch one inbound WhatsApp voice note into memory: the same two Graph hops as
 * the inbox media proxy (app/api/whatsapp/media/[messageId]/route.ts), with the
 * agency's own token for the conversation's number. Never stored anywhere.
 */

export type VoiceDownload = { ok: true; bytes: Uint8Array } | { ok: false; status: 'too_large' | 'failed'; code: string }

/** Graph media lookup, then the file, both with the agency's token, both bounded in time and size. */
export async function downloadVoiceNote(f: typeof fetch, mediaId: string, token: string, remainingMs: () => number = () => VOICE_DOWNLOAD_TIMEOUT_MS): Promise<VoiceDownload> {
  const hop = () => AbortSignal.timeout(Math.max(1, Math.min(VOICE_DOWNLOAD_TIMEOUT_MS, remainingMs())))
  let lookup: Response
  try {
    lookup = await f(`${GRAPH_BASE}/${encodeURIComponent(mediaId)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: hop(),
    })
  } catch {
    return { ok: false, status: 'failed', code: 'media_lookup_failed' }
  }
  if (!lookup.ok) return { ok: false, status: 'failed', code: 'media_lookup_failed' }
  const meta = (await lookup.json().catch(() => null)) as { url?: unknown; file_size?: unknown } | null
  const url = typeof meta?.url === 'string' ? meta.url : ''
  if (!url) return { ok: false, status: 'failed', code: 'media_lookup_failed' }
  const declared = Number(meta?.file_size)
  if (Number.isFinite(declared) && declared > VOICE_NOTE_MAX_BYTES) return { ok: false, status: 'too_large', code: 'declared_too_large' }

  const abort = new AbortController()
  let file: Response
  try {
    file = await f(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.any([abort.signal, hop()]),
    })
  } catch {
    return { ok: false, status: 'failed', code: 'media_fetch_failed' }
  }
  if (!file.ok || !file.body) return { ok: false, status: 'failed', code: 'media_fetch_failed' }
  const length = Number(file.headers.get('content-length'))
  if (Number.isFinite(length) && length > VOICE_NOTE_MAX_BYTES) {
    abort.abort()
    return { ok: false, status: 'too_large', code: 'content_too_large' }
  }
  // Counted as it arrives: neither size header is a promise.
  const reader = file.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > VOICE_NOTE_MAX_BYTES) {
        abort.abort()
        await reader.cancel().catch(() => {})
        return { ok: false, status: 'too_large', code: 'body_too_large' }
      }
      chunks.push(value)
    }
  } catch {
    return { ok: false, status: 'failed', code: 'media_fetch_failed' }
  }
  const bytes = new Uint8Array(total)
  let o = 0
  for (const c of chunks) {
    bytes.set(c, o)
    o += c.byteLength
  }
  return { ok: true, bytes }
}
