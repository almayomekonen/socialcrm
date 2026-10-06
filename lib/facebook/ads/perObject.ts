import { graphRequest, type MetaGraphError } from '@/lib/facebook/graphClient'
import { ADS_API_VERSION } from '@/lib/facebook/ads/apiVersion'

/**
 * Read several Graph objects, one `GET /{id}` each, a few at a time.
 *
 * WHY NOT `GET /?ids=a,b,c`. Graph API v26.0 changelog, "Legacy Graph API
 * protocol features deprecated": "Root requests using GET /?ids=... return an
 * error. Use per-object requests or supported batching." It applies to v26.0
 * now and to ALL remaining versions on 2026-10-27. Per-object reads count
 * against Meta's rate limits exactly as the ids-list items did, so the cost is
 * the same; the reads are capped and run with bounded concurrency.
 *
 * Ids must already be validated Meta object ids (the callers use isAdObjectId).
 * Any error stops the read and is returned, except an object Meta says is gone
 * (100/33), which only drops that object.
 */

export const PER_OBJECT_CONCURRENCY = 6

/**
 * Only "this object is gone or unreadable" (Meta's 100 + subcode 33) skips one
 * object. Anything else — auth, permission, throttling, a Meta service error —
 * stops the read, so the caller reports the whole lookup as unavailable rather
 * than silently showing gaps as if they were answers.
 */
const isFatal = (e: MetaGraphError) => !(e.kind === 'graph' && e.code === 100 && e.subcode === 33)

export async function readObjects<T extends Record<string, unknown>>(
  token: string,
  ids: string[],
  query: Record<string, string | number>,
  opts: { max: number },
): Promise<{ values: Map<string, T>; error: MetaGraphError | null }> {
  const values = new Map<string, T>()
  const list = [...new Set(ids)].slice(0, opts.max)
  for (let i = 0; i < list.length; i += PER_OBJECT_CONCURRENCY) {
    const chunk = list.slice(i, i + PER_OBJECT_CONCURRENCY)
    const results = await Promise.all(
      chunk.map((id) => graphRequest<T>({ path: `/${encodeURIComponent(id)}`, token, query, version: ADS_API_VERSION })),
    )
    for (let j = 0; j < chunk.length; j++) {
      const res = results[j]
      if ('error' in res) {
        if (isFatal(res.error)) return { values, error: res.error }
        continue
      }
      if (res.data && typeof res.data === 'object') values.set(chunk[j], res.data)
    }
  }
  return { values, error: null }
}
