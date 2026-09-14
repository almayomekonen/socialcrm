import { createHmac } from 'node:crypto'
import { GRAPH_BASE } from '@/lib/facebook/graph'
import { redactSecrets } from '@/lib/facebook/pageDiscoveryDiagnostics'

/**
 * The one Graph API primitive for Page-token features (comment replies,
 * Messenger, ad reporting).
 *
 * TOKEN HYGIENE, BY CONSTRUCTION:
 *  · the token travels in the `Authorization: Bearer` header — never in a URL,
 *    so it cannot land in an access log, a proxy log or an error message;
 *  · `appsecret_proof` binds each call to this app's secret, so a leaked token
 *    alone is not enough to call Graph as SocialCRM;
 *  · `paging.next` / `paging.previous` are stripped from every response — Meta
 *    embeds the access token in those URLs, and a caller that forwarded a raw
 *    page of results to the browser would forward the token with it;
 *  · error text is redacted and truncated, and is for server logs only.
 *
 * NEVER THROWS for a Meta or network failure — it returns a typed error so the
 * feature can tell "permission missing" from "window closed" from "Meta is
 * down" and show the right Hebrew message. It DOES throw for a malformed path,
 * which is a programming error, not a runtime condition.
 */

export type MetaGraphErrorKind = 'graph' | 'network' | 'timeout' | 'invalid_response'

export type MetaGraphError = {
  kind: MetaGraphErrorKind
  /** HTTP status; 0 when the request never completed. */
  status: number
  code: number | null
  subcode: number | null
  type: string | null
  /** Redacted, truncated. Server logs only — never render or return it. */
  message: string | null
}

export type GraphResult<T> = { ok: true; data: T } | { ok: false; error: MetaGraphError }

type Query = Record<string, string | number | boolean | undefined | null>

export type GraphRequest = {
  method?: 'GET' | 'POST' | 'DELETE'
  /** Starts with '/', carries no querystring. */
  path: string
  token: string
  query?: Query
  body?: Record<string, unknown>
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

const DEFAULT_TIMEOUT_MS = 8000

export function appSecretProof(token: string, secret: string | undefined = process.env.META_APP_SECRET): string | null {
  if (!token || !secret) return null
  return createHmac('sha256', secret).update(token).digest('hex')
}

/** Remove every `paging.next` / `paging.previous` URL, at any depth. */
export function stripPagingUrls<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => stripPagingUrls(v)) as T
  if (typeof value !== 'object' || value === null) return value
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (k === 'paging' && typeof v === 'object' && v !== null && !Array.isArray(v)) {
      const { next: _next, previous: _previous, ...rest } = v as Record<string, unknown>
      out[k] = stripPagingUrls(rest)
    } else {
      out[k] = stripPagingUrls(v)
    }
  }
  return out as T
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null)

export function parseGraphError(status: number, body: unknown): MetaGraphError {
  const e = (body as { error?: Record<string, unknown> } | null)?.error ?? {}
  const message = str(e.message)
  return {
    kind: 'graph',
    status,
    code: num(e.code),
    subcode: num(e.error_subcode),
    type: str(e.type),
    message: message ? redactSecrets(message).slice(0, 300) : null,
  }
}

/** One line for a server log. Carries no token, no URL, no user content. */
export function describeGraphError(error: MetaGraphError): string {
  return `kind=${error.kind} status=${error.status} code=${error.code ?? '-'} subcode=${error.subcode ?? '-'}`
}

function buildUrl(path: string, query: Query | undefined, token: string): string {
  if (!path.startsWith('/') || path.includes('?') || /access_token/i.test(path)) {
    throw new Error('invalid_graph_path')
  }
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v === undefined || v === null) continue
    if (/^access_token$/i.test(k)) throw new Error('invalid_graph_query')
    params.set(k, String(v))
  }
  const proof = appSecretProof(token)
  if (proof) params.set('appsecret_proof', proof)
  const qs = params.toString()
  return `${GRAPH_BASE}${path}${qs ? `?${qs}` : ''}`
}

export async function graphRequest<T = unknown>(req: GraphRequest): Promise<GraphResult<T>> {
  const url = buildUrl(req.path, req.query, req.token)
  const doFetch = req.fetchImpl ?? fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), req.timeoutMs ?? DEFAULT_TIMEOUT_MS)

  let res: Response
  try {
    res = await doFetch(url, {
      method: req.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${req.token}`,
        ...(req.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: req.body ? JSON.stringify(req.body) : undefined,
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
  if (body === null) {
    return {
      ok: false,
      error: { kind: 'invalid_response', status: res.status, code: null, subcode: null, type: null, message: null },
    }
  }
  return { ok: true, data: stripPagingUrls(body) as T }
}
