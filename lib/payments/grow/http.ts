import { getGrowApiConfig } from './config'

/**
 * Grow's Light API transport. Every request is multipart/form-data, sent from
 * the server only (Grow blocks browser requests). Every answer uses the same
 * documented envelope: { status: 1|0, err: '' | { id, message }, data }.
 *
 * Transport failures (timeout, network, non-2xx, non-JSON) are THROWN as
 * GrowTransportError because their money outcome is unknown. A Grow business
 * error (status 0) is RETURNED in the envelope, because Grow answered.
 */

export type GrowEnvelope = { status: 0 | 1; err: { id: number | null; message: string } | null; data: unknown }

export class GrowTransportError extends Error {
  constructor(
    public reason: 'timeout' | 'network' | 'http_status' | 'invalid_json',
    public httpStatus?: number,
  ) {
    super(`grow.transport.${reason}`)
    this.name = 'GrowTransportError'
  }
}

const DEFAULT_TIMEOUT_MS = 15_000

export function normalizeEnvelope(body: unknown): GrowEnvelope {
  const b = (body ?? {}) as Record<string, unknown>
  const status = Number(b.status) === 1 ? 1 : 0
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
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    const name = (err as { name?: string })?.name
    throw new GrowTransportError(name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network')
  }
  if (!res.ok) throw new GrowTransportError('http_status', res.status)

  let body: unknown
  try {
    body = await res.json()
  } catch {
    throw new GrowTransportError('invalid_json', res.status)
  }
  return normalizeEnvelope(body)
}
