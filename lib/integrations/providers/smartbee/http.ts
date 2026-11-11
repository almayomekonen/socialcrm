import { SMARTBEE_TIMEOUT_MS, smartbeeBaseUrl } from './config'
import type { IntegrationEnvironment } from '@/lib/integrations/core/types'
import type { SmartbeeEnvelope } from './types'

/**
 * SmartBee's transport, server-to-server only (SmartBee has no CORS). One
 * request per call, never retried here: whether a retry is safe depends on the
 * operation, so the caller decides (documents.ts).
 *
 * A non-2xx answer is RETURNED with its status (400 validation, 401 expired JWT,
 * 429 rate limit, 503 restarting). Only an outcome nobody can read is THROWN:
 * timeout, network, a redirect (never followed: it would re-send the body,
 * which carries the business token, to another host), or a 2xx that is not JSON.
 *
 * Nothing here logs a request or response body: bodies carry the
 * providerUserToken and customer details.
 */

export class SmartbeeTransportError extends Error {
  constructor(public reason: 'timeout' | 'network' | 'redirect' | 'invalid_json') {
    super(`smartbee.transport.${reason}`)
    this.name = 'SmartbeeTransportError'
  }
}

export type SmartbeeHttpResult = { status: number; body: unknown }
export type SmartbeeFetch = typeof fetch

const isTimeout = (err: unknown) => {
  const name = (err as { name?: string })?.name
  return name === 'TimeoutError' || name === 'AbortError'
}

export async function smartbeeFetch(input: {
  env: IntegrationEnvironment
  method: 'GET' | 'POST'
  path: string
  body?: unknown
  bearer?: string
  timeoutMs?: number
  fetchImpl?: SmartbeeFetch
}): Promise<SmartbeeHttpResult> {
  const url = `${smartbeeBaseUrl(input.env)}${input.path}`
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (input.body !== undefined) headers['Content-Type'] = 'application/json'
  if (input.bearer) headers.Authorization = `Bearer ${input.bearer}`

  let res: Response
  try {
    res = await (input.fetchImpl ?? fetch)(url, {
      method: input.method,
      headers,
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
      cache: 'no-store',
      redirect: 'manual',
      signal: AbortSignal.timeout(input.timeoutMs ?? SMARTBEE_TIMEOUT_MS),
    })
  } catch (err) {
    throw new SmartbeeTransportError(isTimeout(err) ? 'timeout' : 'network')
  }
  if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) throw new SmartbeeTransportError('redirect')

  let text: string
  try {
    text = await res.text()
  } catch (err) {
    throw new SmartbeeTransportError(isTimeout(err) ? 'timeout' : 'network')
  }
  let body: unknown = null
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      if (res.ok) throw new SmartbeeTransportError('invalid_json')
      body = null
    }
  }
  return { status: res.status, body }
}

/** The `{ resultCodeId, result, validationErrors }` envelope, or null when the body is not one. */
export function readEnvelope(body: unknown): SmartbeeEnvelope | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const b = body as Record<string, unknown>
  const code = typeof b.resultCodeId === 'string' ? Number(b.resultCodeId) : b.resultCodeId
  if (typeof code !== 'number' || !Number.isInteger(code)) return null
  const errors = b.validationErrors
  return {
    resultCodeId: code,
    result: b.result ?? null,
    validationErrors: errors && typeof errors === 'object' && !Array.isArray(errors) ? (errors as Record<string, unknown>) : null,
  }
}

/** ASP.NET ProblemDetails `errors` from an HTTP 400 (field → messages), or null. */
export function readProblemErrors(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== 'object') return null
  const errors = (body as { errors?: unknown }).errors
  return errors && typeof errors === 'object' && !Array.isArray(errors) ? (errors as Record<string, unknown>) : null
}
