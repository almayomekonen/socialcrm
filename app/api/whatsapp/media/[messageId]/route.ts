import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/config/db'
import { getUser } from '@/db/auth'
import { ATTACHMENT_MEDIA_TYPES, sanitizeAttachmentFilename, sanitizeAttachmentMime } from '@/db/inboxMessages'
import { GRAPH_BASE } from '@/lib/facebook/graph'
import { resolveWhatsappAccessToken } from '@/lib/whatsapp/connectionToken'

/**
 * Authenticated download for an inbound WhatsApp media file.
 *
 * WhatsApp media cannot be linked to directly: Meta returns a short-lived URL
 * that requires the agency's Bearer token, so the file has to be fetched
 * server-side and streamed. Nothing about that capability — media id, Meta URL,
 * access token — ever reaches the browser; the media id is re-derived here from
 * the message row, which is why the client shape carries only filename + mime.
 *
 * The message lookup is scoped by `agencyId` in the SAME query as the id. That
 * is the whole cross-tenant control: a message belonging to another agency is
 * not "forbidden", it simply does not exist for this caller.
 *
 * No storage, no S3, no background job — the file is proxied on demand.
 */

/**
 * Hard ceiling on what this route will forward. Same 25 MB the project already
 * uses for remote fetch-and-stream (`lib/integrations/google/driveFileReader.ts`),
 * so there is one number to reason about rather than two.
 */
export const MAX_MEDIA_BYTES = 25 * 1024 * 1024

/** Upstream budget for each Graph hop. */
const UPSTREAM_TIMEOUT_MS = 15_000

function fail(reason: string, status: number) {
  return NextResponse.json({ ok: false, reason }, { status })
}

/**
 * Hard byte cap applied to the stream itself.
 *
 * `file_size` and `content-length` are both ADVISORY — Graph may omit either,
 * and a chunked response has no length at all. Without this counter a body that
 * declares nothing could be forwarded without bound. Counting as we go keeps the
 * guarantee without buffering the file: the moment the limit is passed we abort
 * the upstream request and error the stream, so nothing further is read or sent.
 *
 * The status line is already on the wire by then, so the client sees a failed
 * transfer rather than a 413. That is the honest outcome — the pre-checks above
 * catch every case where a controlled status is still possible.
 */
export function cappedStream(
  source: ReadableStream<Uint8Array>,
  limit: number,
  abortUpstream: () => void,
): ReadableStream<Uint8Array> {
  let forwarded = 0
  return source.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        forwarded += chunk.byteLength
        if (forwarded > limit) {
          abortUpstream()
          controller.error(new Error('media_too_large'))
          return
        }
        controller.enqueue(chunk)
      },
    }),
  )
}

/** ASCII-only fallback for the legacy `filename=` parameter. */
function asciiFallback(s: string): string {
  return s.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_')
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ messageId: string }> }) {
  const user = await getUser()
  if (!user?.agencyId) return fail('unauthorized', 401)

  const { messageId: rawId } = await params
  const messageId = Number(rawId)
  if (!Number.isInteger(messageId) || messageId <= 0) return fail('invalid_message_id', 400)

  // Id AND agency in one predicate — never fetch first and authorize after.
  const message = await db('inbox_messages')
    .where({ id: messageId, agencyId: user.agencyId })
    .first('id', 'type', 'payload')
  if (!message) return fail('message_not_found', 404)

  if (typeof message.type !== 'string' || !ATTACHMENT_MEDIA_TYPES.has(message.type)) {
    return fail('unsupported_message_type', 415)
  }

  const payload = (message.payload ?? {}) as Record<string, unknown>
  const mediaId = typeof payload.id === 'string' ? payload.id.trim() : ''
  if (!mediaId) return fail('media_unavailable', 404)

  const connection = await db('whatsapp_connections')
    .where({ agency_id: user.agencyId })
    .first('access_token')
  const token = resolveWhatsappAccessToken(connection?.access_token)
  // A disconnected agency has no token, so its historical media is unreachable.
  if (!token) return fail('whatsapp_not_connected', 409)

  let lookup: Response
  try {
    lookup = await fetch(`${GRAPH_BASE}/${encodeURIComponent(mediaId)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    })
  } catch {
    return fail('media_lookup_failed', 502)
  }
  if (!lookup.ok) return fail('media_lookup_failed', 502)

  const meta = (await lookup.json().catch(() => null)) as
    | { url?: unknown; mime_type?: unknown; file_size?: unknown }
    | null
  const mediaUrl = typeof meta?.url === 'string' ? meta.url : ''
  if (!mediaUrl) return fail('media_lookup_failed', 502)

  const declaredSize = Number(meta?.file_size)
  if (Number.isFinite(declaredSize) && declaredSize > MAX_MEDIA_BYTES) return fail('media_too_large', 413)

  // Own controller so the size cap can cut the upstream request off mid-stream;
  // combined with the same timeout budget the metadata lookup gets.
  const download = new AbortController()
  let file: Response
  try {
    file = await fetch(mediaUrl, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.any([download.signal, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)]),
    })
  } catch {
    return fail('media_fetch_failed', 502)
  }
  if (!file.ok || !file.body) return fail('media_fetch_failed', 502)

  const length = Number(file.headers.get('content-length'))
  if (Number.isFinite(length) && length > MAX_MEDIA_BYTES) return fail('media_too_large', 413)

  // Trust our own stored value first; Graph's is only a fallback. Both are
  // sanitized, so a hostile mime can never reach the Content-Type header.
  const mime =
    sanitizeAttachmentMime(payload.mime_type) ?? sanitizeAttachmentMime(meta?.mime_type) ?? 'application/octet-stream'
  const filename = sanitizeAttachmentFilename(payload.filename) ?? `whatsapp-${messageId}`

  const headers = new Headers({
    'Content-Type': mime,
    // RFC 5987: ASCII fallback plus UTF-8 form so Hebrew filenames survive.
    'Content-Disposition': `attachment; filename="${asciiFallback(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
    'Referrer-Policy': 'no-referrer',
  })
  if (Number.isFinite(length) && length > 0) headers.set('Content-Length', String(length))

  return new NextResponse(cappedStream(file.body, MAX_MEDIA_BYTES, () => download.abort()), { status: 200, headers })
}
