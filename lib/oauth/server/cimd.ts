import 'server-only'
import { z } from 'zod'

/**
 * Client ID Metadata Document resolver — NOT a general URL fetcher.
 *
 * The only network call it makes is to an https URL on an EXACT allowlisted
 * hostname (default chatgpt.com): no IP literals, no loopback names, no port, no
 * userinfo, no query or fragment, a non-root path, and the string must already be
 * in canonical form. That allowlist IS the SSRF boundary — we never connect to a
 * host we did not name. Redirects are followed manually, at most twice, and every
 * destination passes the same policy BEFORE it is requested. One deadline covers
 * the whole resolution. Every failure is closed and never cached.
 *
 * Nothing here is exported that fetches an arbitrary URL.
 */

export type ResolvedClient = { clientId: string; clientName: string; redirectUris: string[] }
export type CimdFailure =
  | 'client_id_not_allowed'
  | 'fetch_failed'
  | 'redirect_not_allowed'
  | 'too_many_redirects'
  | 'too_large'
  | 'not_json'
  | 'invalid_document'
  | 'client_id_mismatch'
  | 'unsupported_auth_method'
export type CimdResult = { ok: true; client: ResolvedClient } | { ok: false; reason: CimdFailure }

type FetchFn = (url: string, init: RequestInit) => Promise<Response>
type Deps = { fetch?: FetchFn; trustedHosts?: string[]; timeoutMs?: number; now?: () => number }

const MAX_BYTES = 64 * 1024
const MAX_REDIRECTS = 2
const TIMEOUT_MS = 5_000
const DEFAULT_TTL_MS = 10 * 60_000
const MAX_TTL_MS = 60 * 60_000
const MAX_CACHE_ENTRIES = 50
const SUPPORTED_AUTH_METHODS: readonly string[] = ['none']

// ── Cache: validated documents only, keyed by the validated client_id. ─────────
const cache = new Map<string, { client: ResolvedClient; expiresAt: number }>()
export function __resetCimdCacheForTests(): void {
  cache.clear()
}

// ── URL policy (client_id and every redirect destination) ──────────────────────
const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/
// Lowercase dotted hostname, NO port, NO userinfo, non-root path, nothing after it.
const POLICY_RE = /^https:\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)+)(\/[^?#\s\\]+)$/

function isLoopbackOrIp(host: string): boolean {
  return IPV4_RE.test(host) || host === 'localhost' || host.endsWith('.localhost') || host.includes(':') || host.includes('[')
}

export function trustedClientHosts(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.MCP_TRUSTED_CLIENT_ID_HOSTS?.trim() || 'chatgpt.com'
  return raw
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter((h) => h !== '' && !isLoopbackOrIp(h))
}

/**
 * The single URL gate. Matches on the raw string (so `:443`, dot segments and
 * encodings are never normalised away) and then requires the WHATWG form to be
 * byte-identical, which rejects anything the parser would rewrite.
 */
function allowedUrl(raw: string, trustedHosts: readonly string[]): string | null {
  if (typeof raw !== 'string') return null
  const m = POLICY_RE.exec(raw)
  if (!m) return null
  const host = m[1]
  if (m[2] === '/' || isLoopbackOrIp(host) || !trustedHosts.includes(host)) return null
  try {
    if (new URL(raw).href !== raw) return null
  } catch {
    return null
  }
  return raw
}

/** Turns a Location header into a candidate URL for allowedUrl; never fetches. */
function redirectCandidate(location: string, current: string): string | null {
  if (!location || /[\s\\]/.test(location)) return null
  if (/^[a-z][a-z0-9+.-]*:/i.test(location)) return location // absolute: validate as written
  if (location.startsWith('//')) return `https:${location}` // protocol-relative: same, as written
  try {
    return new URL(location, current).href // relative: resolve against the validated URL
  } catch {
    return null
  }
}

// ── Document schema ────────────────────────────────────────────────────────────
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/
const DocSchema = z.object({
  client_id: z.string().min(1).max(2048),
  client_name: z
    .string()
    .max(200)
    .refine((s) => s.trim().length > 0 && !CONTROL_RE.test(s)),
  redirect_uris: z.array(z.string().min(1).max(2048)).min(1).max(10),
  token_endpoint_auth_method: z.string().optional(),
  token_endpoint_auth_methods_supported: z.array(z.string()).optional(),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
})

function redirectUriShapeOk(r: string): boolean {
  if (/[\s\\#]/.test(r)) return false
  let u: URL
  try {
    u = new URL(r)
  } catch {
    return false
  }
  if (u.username || u.password) return false
  if (u.protocol === 'https:') return true
  const devLoopback =
    u.protocol === 'http:' &&
    (u.hostname === '127.0.0.1' || u.hostname === 'localhost') &&
    process.env.MCP_ALLOW_LOOPBACK_REDIRECTS === '1' &&
    process.env.NODE_ENV !== 'production'
  return devLoopback
}

function isJsonMediaType(contentType: string | null): boolean {
  const media = (contentType ?? '').split(';')[0].trim().toLowerCase()
  return media === 'application/json' || /^application\/[a-z0-9.+-]+\+json$/.test(media)
}

// ── Bounded body read ──────────────────────────────────────────────────────────
type BodyRead = { kind: 'ok'; text: string } | { kind: 'too_large' } | { kind: 'aborted' }

async function readCapped(res: Response, signal: AbortSignal): Promise<BodyRead> {
  const declared = Number(res.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > MAX_BYTES) return { kind: 'too_large' }
  const reader = res.body?.getReader()
  if (!reader) return { kind: 'ok', text: '' }

  const aborted = new Promise<'aborted'>((resolve) => {
    if (signal.aborted) resolve('aborted')
    else signal.addEventListener('abort', () => resolve('aborted'), { once: true })
  })
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const next = await Promise.race([reader.read(), aborted])
    if (next === 'aborted') {
      await reader.cancel().catch(() => undefined)
      return { kind: 'aborted' }
    }
    if (next.done) break
    total += next.value.byteLength
    if (total > MAX_BYTES) {
      await reader.cancel().catch(() => undefined) // stop pulling immediately
      return { kind: 'too_large' }
    }
    chunks.push(next.value)
  }
  return { kind: 'ok', text: Buffer.concat(chunks).toString('utf8') }
}

function ttlFrom(res: Response): number {
  const cc = (res.headers.get('cache-control') ?? '').toLowerCase()
  if (cc.includes('no-store')) return 0
  const m = /max-age=(\d+)/.exec(cc)
  return m ? Math.min(Number(m[1]) * 1000, MAX_TTL_MS) : DEFAULT_TTL_MS
}

// ── Resolver ───────────────────────────────────────────────────────────────────
export async function resolveClient(clientId: string, deps: Deps = {}): Promise<CimdResult> {
  const doFetch: FetchFn = deps.fetch ?? ((u, i) => fetch(u, i))
  const trustedHosts = deps.trustedHosts ?? trustedClientHosts()
  const now = deps.now ?? Date.now

  if (!allowedUrl(clientId, trustedHosts)) return { ok: false, reason: 'client_id_not_allowed' }

  const hit = cache.get(clientId)
  if (hit && hit.expiresAt > now()) return { ok: true, client: hit.client }
  if (hit) cache.delete(clientId)

  // One deadline for every hop and the body read together.
  const signal = AbortSignal.timeout(deps.timeoutMs ?? TIMEOUT_MS)
  let url = clientId
  let res: Response | null = null
  for (let hop = 0; ; hop++) {
    try {
      res = await doFetch(url, {
        method: 'GET',
        redirect: 'manual',
        credentials: 'omit',
        headers: { accept: 'application/json' },
        signal,
      })
    } catch {
      return { ok: false, reason: 'fetch_failed' }
    }
    if (res.status < 300 || res.status >= 400) break
    if (hop >= MAX_REDIRECTS) return { ok: false, reason: 'too_many_redirects' }
    const candidate = redirectCandidate(res.headers.get('location') ?? '', url)
    const next = candidate ? allowedUrl(candidate, trustedHosts) : null
    if (!next) return { ok: false, reason: 'redirect_not_allowed' }
    url = next
  }

  if (res.status !== 200) return { ok: false, reason: 'fetch_failed' }
  if (!isJsonMediaType(res.headers.get('content-type'))) return { ok: false, reason: 'not_json' }

  const body = await readCapped(res, signal)
  if (body.kind === 'aborted') return { ok: false, reason: 'fetch_failed' }
  if (body.kind === 'too_large') return { ok: false, reason: 'too_large' }

  let raw: unknown
  try {
    raw = JSON.parse(body.text)
  } catch {
    return { ok: false, reason: 'not_json' }
  }
  const parsed = DocSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, reason: 'invalid_document' }
  const doc = parsed.data

  if (doc.client_id !== clientId) return { ok: false, reason: 'client_id_mismatch' }
  if (!doc.redirect_uris.every(redirectUriShapeOk)) return { ok: false, reason: 'invalid_document' }
  if (doc.grant_types && !doc.grant_types.includes('authorization_code')) return { ok: false, reason: 'invalid_document' }
  if (doc.response_types && !doc.response_types.includes('code')) return { ok: false, reason: 'invalid_document' }

  // No guessed defaults: RFC 7591 says an absent method means client_secret_basic,
  // which this server does not support, so absence is a rejection.
  const offered =
    doc.token_endpoint_auth_methods_supported ??
    (doc.token_endpoint_auth_method ? [doc.token_endpoint_auth_method] : ['client_secret_basic'])
  if (!offered.some((m) => SUPPORTED_AUTH_METHODS.includes(m))) return { ok: false, reason: 'unsupported_auth_method' }

  const client: ResolvedClient = { clientId, clientName: doc.client_name.trim(), redirectUris: doc.redirect_uris }
  const ttl = ttlFrom(res)
  if (ttl > 0) {
    while (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value as string)
    cache.set(clientId, { client, expiresAt: now() + ttl })
  }
  return { ok: true, client }
}
