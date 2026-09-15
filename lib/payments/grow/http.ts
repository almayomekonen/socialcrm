import { getGrowApiConfig } from './config'

/**
 * Grow's Light API transport. Every request is multipart/form-data, sent from
 * the server only (Grow blocks browser requests). Every answer uses the same
 * documented envelope: { status: 1|0, err: '' | { id, message }, data }.
 *
 * Transport failures (timeout, network, redirect, non-2xx, non-JSON, or a body
 * that is not the documented envelope) are THROWN as GrowTransportError because
 * their money outcome is unknown. A Grow business error (status 0) is RETURNED
 * in the envelope, because Grow answered.
 *
 * One request per call, never retried here: a repeated charge request is only
 * safe once Grow's duplicate-identifier behaviour is proven (Gate B). Redirects
 * are never followed — a 307/308 would re-send the form (userId, pageCode,
 * cardToken) to whatever host the Location names.
 */

export type GrowEnvelope = { status: 0 | 1; err: { id: number | null; message: string } | null; data: unknown }

export class GrowTransportError extends Error {
  constructor(
    public reason: 'timeout' | 'network' | 'redirect' | 'http_status' | 'invalid_json' | 'invalid_envelope',
    public httpStatus?: number,
  ) {
    super(`grow.transport.${reason}`)
    this.name = 'GrowTransportError'
  }
}

const DEFAULT_TIMEOUT_MS = 15_000

function isTimeout(err: unknown): boolean {
  const name = (err as { name?: string })?.name
  return name === 'TimeoutError' || name === 'AbortError'
}

/** Throws unless `status` is the documented 1 or 0: anything else is an unknown outcome, never a Grow refusal. */
export function normalizeEnvelope(body: unknown): GrowEnvelope {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new GrowTransportError('invalid_envelope')
  const b = body as Record<string, unknown>
  const rawStatus = typeof b.status === 'string' ? b.status.trim() : b.status
  if (rawStatus !== 1 && rawStatus !== 0 && rawStatus !== '1' && rawStatus !== '0') throw new GrowTransportError('invalid_envelope')
  const status = Number(rawStatus) === 1 ? 1 : 0
  const rawErr = b.err
  let err: GrowEnvelope['err'] = null
  if (rawErr && typeof rawErr === 'object') {
    const e = rawErr as Record<string, unknown>
    err = { id: e.id == null || e.id === '' ? null : Number(e.id), message: String(e.message ?? '') }
  } else if (typeof rawErr === 'string' && rawErr.trim()) {
    err = { id: null, message: rawErr.trim() }
  }
  return { status, err, data: b.data ?? null }
}

export async function postGrowForm(
  path: string,
  fields: Record<string, string | number>,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<GrowEnvelope> {
  const { baseUrl } = getGrowApiConfig()
  const form = new FormData()
  for (const [key, value] of Object.entries(fields)) form.append(key, String(value))

  let res: Response
  try {
    res = await fetch(`${baseUrl}/${path}`, {
      method: 'POST',
      body: form,
      cache: 'no-store',
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw new GrowTransportError(isTimeout(err) ? 'timeout' : 'network')
  }
  if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
    throw new GrowTransportError('redirect', res.status || undefined)
  }
  if (!res.ok) throw new GrowTransportError('http_status', res.status)

  let body: unknown
  try {
    body = await res.json()
  } catch (err) {
    // The timeout also covers reading the body; a stalled body is a timeout, not bad JSON.
    throw new GrowTransportError(isTimeout(err) ? 'timeout' : 'invalid_json', res.status)
  }
  return normalizeEnvelope(body)
}
