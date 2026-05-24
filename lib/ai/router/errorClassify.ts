// Coarse error-code classifier used by the router for log tags + retry /
// fallback decisions. Categories are intentionally string-shaped so they can
// be persisted to ai_runs without a separate enum.
export function classifyError(err: unknown): string {
  const msg = ((err as Error)?.message ?? '').toLowerCase()
  if (msg.includes('abort') || msg.includes('timeout')) return 'timeout'
  if (msg.includes('rate') && msg.includes('limit')) return 'rate-limit'
  if (msg.includes('401') || msg.includes('unauthor')) return 'auth'
  if (msg.includes('400')) return 'bad-request'
  if (msg.includes('5')) return 'server-error'
  return 'unknown'
}
