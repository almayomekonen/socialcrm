// Today brief v2 — production monitoring. Structured, greppable log events (prefix
// [today-brief]) an operator can build alerts on: feature usage, latency,
// unexpected empty DTO, build failures, and rollback (error-fallback to legacy).
// No PII beyond agencyId. Timestamps come from the caller (server), not here.

type ServedEvent = { agencyId: number; latencyMs: number; total: number; remaining: number; empty: boolean }
type FailureEvent = { agencyId: number; latencyMs: number; error: string }

// Feature usage + latency + unexpected-empty. `empty:true` on a data-bearing
// account is the signal to investigate a facts/scope regression.
export function logBriefServed(e: ServedEvent): void {
  console.log('[today-brief]', JSON.stringify({ evt: 'served', path: 'v2', ...e }))
}

// buildTodayBrief failure → the page falls back to legacy (instant rollback for
// this request). A spike here is the rollback/health signal.
export function logBriefFailure(e: FailureEvent): void {
  console.error('[today-brief]', JSON.stringify({ evt: 'failure', path: 'v2_fallback_legacy', ...e }))
}
