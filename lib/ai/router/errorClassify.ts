// Coarse error-code classifier used by the router for log tags + retry /
// fallback decisions. Categories are intentionally string-shaped so they can
// be persisted to ai_runs without a separate enum.
//
// PERMANENT failures (billing/credit exhausted, quota exhausted, a model the
// account cannot use, invalid key, auth, bad request) are deterministic: the
// identical request to the identical provider yields the identical failure, so
// they must never be retried on the same provider — fail over immediately.
//
// The HTTP status, when the SDK provides one (`APICallError.statusCode`, also
// reachable through `RetryError.lastError` and `cause`), decides the transport
// class. Message text decides only what the status cannot: billing and quota
// (Anthropic's credit error is an HTTP 400) and model availability. Digits are
// matched as whole HTTP codes, never as a bare character — a model name such
// as "gemini-2.5-flash-lite" must not make an error look like a 5xx.
// Order matters: specific permanent causes are matched before generic buckets
// (billing and quota before rate-limit, model availability before not-found).

const MODEL_UNAVAILABLE =
  /no longer available|is not found|not found for api version|does not exist|model_not_found|not supported for (?:this|generatecontent)|has been deprecated|is deprecated/

const SERVER_ERROR_TEXT = /\b5\d\d\b|internal server error|service unavailable|bad gateway|gateway timeout|overloaded/

function statusOf(err: unknown): number | null {
  const e = err as { statusCode?: unknown; status?: unknown; lastError?: unknown; cause?: unknown } | null
  for (const candidate of [e, e?.lastError, e?.cause] as Array<{ statusCode?: unknown; status?: unknown } | undefined>) {
    const s = candidate?.statusCode ?? candidate?.status
    if (typeof s === 'number' && s >= 100 && s <= 599) return s
  }
  return null
}

function messageOf(err: unknown): string {
  const e = err as { message?: unknown; lastError?: { message?: unknown } } | null
  const own = typeof e?.message === 'string' ? e.message : ''
  const last = typeof e?.lastError?.message === 'string' ? e.lastError.message : ''
  return `${own} ${last}`.toLowerCase()
}

export function classifyError(err: unknown): string {
  const msg = messageOf(err)
  const name = (err as { name?: unknown } | null)?.name
  const status = statusOf(err)

  if (name === 'AbortError' || name === 'TimeoutError' || msg.includes('abort') || msg.includes('timeout')) return 'timeout'
  if (msg.includes('credit') || msg.includes('billing') || msg.includes('insufficient')) return 'billing'
  if (msg.includes('quota')) return 'quota'
  if (MODEL_UNAVAILABLE.test(msg)) return 'model-unavailable'
  if (msg.includes('invalid') && msg.includes('key')) return 'invalid-key'

  if (status != null) {
    if (status === 401 || status === 403) return 'auth'
    if (status === 404) return 'model-unavailable'
    if (status === 408) return 'timeout'
    if (status === 429) return 'rate-limit'
    if (status >= 500) return 'server-error'
    if (status >= 400) return 'bad-request'
  }

  if (/\b401\b/.test(msg) || /\b403\b/.test(msg) || msg.includes('unauthor') || msg.includes('authentication')) return 'auth'
  if (/\b429\b/.test(msg) || (msg.includes('rate') && msg.includes('limit'))) return 'rate-limit'
  if (/\b400\b/.test(msg)) return 'bad-request'
  if (SERVER_ERROR_TEXT.test(msg)) return 'server-error'
  return 'unknown'
}

/** Deterministic failures that cannot succeed on a same-provider retry. */
const PERMANENT = new Set(['billing', 'quota', 'model-unavailable', 'invalid-key', 'auth', 'bad-request'])

export function isPermanentError(code: string): boolean {
  return PERMANENT.has(code)
}
