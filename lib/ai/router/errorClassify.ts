// Coarse error-code classifier used by the router for log tags + retry /
// fallback decisions. Categories are intentionally string-shaped so they can
// be persisted to ai_runs without a separate enum.
//
// PERMANENT failures (billing/credit exhausted, quota exhausted, invalid key,
// auth, bad request) are deterministic: the identical request to the identical
// provider yields the identical failure, so they must never be retried on the
// same provider — fail over immediately. Order matters: specific permanent
// causes are matched before the generic transient buckets (quota before
// rate-limit, billing before server-error).
export function classifyError(err: unknown): string {
  const msg = ((err as Error)?.message ?? '').toLowerCase()
  if (msg.includes('abort') || msg.includes('timeout')) return 'timeout'
  if (msg.includes('credit') || msg.includes('billing') || msg.includes('insufficient')) return 'billing'
  if (msg.includes('quota')) return 'quota'
  if (msg.includes('invalid') && msg.includes('key')) return 'invalid-key'
  if (msg.includes('401') || msg.includes('unauthor') || msg.includes('authentication')) return 'auth'
  if (msg.includes('rate') && msg.includes('limit')) return 'rate-limit'
  if (msg.includes('400')) return 'bad-request'
  if (msg.includes('5')) return 'server-error'
  return 'unknown'
}

/** Deterministic failures that cannot succeed on a same-provider retry. */
const PERMANENT = new Set(['billing', 'quota', 'invalid-key', 'auth', 'bad-request'])

export function isPermanentError(code: string): boolean {
  return PERMANENT.has(code)
}
