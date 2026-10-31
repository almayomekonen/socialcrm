/**
 * Operational events for the shadow budget: one structured line each on the
 * platform log (the same `[tag] {json}` convention as `[today-brief]` and
 * `[decision-trace]`), so they reach the log drain and alerting without the
 * database. NEVER written to the database: a reservation that failed because
 * the database failed must not have its only record in that database.
 *
 *   [ai-budget]
 *   reservation_failed    no reservation exists for this provider request
 *   settlement_failed     a reservation was left `reserved` for the expiry sweep
 *   run_identity_missing  a request with no logical run (the run scope is skipped)
 *   expiry_failed         one stale reservation could not be settled (it stays
 *                         `reserved`; the next sweep retries it)
 *   expiry_sweep_failed   the sweep itself failed (nothing was settled)
 *   expiry_swept          a sweep settled stale reservations (counts only)
 *
 *   [ai-usage]
 *   ledger_write_delayed  the ledger insert outlived the request's bounded wait;
 *                         it continues under the request lifecycle
 *   ledger_write_failed   the ledger insert failed: those rows are missing
 *
 * IDENTIFIERS AND CATEGORIES ONLY. No message text, prompt, phone number,
 * credential or raw error text — a Postgres message can echo the row's values.
 * An error contributes its class name and its SQLSTATE code, both fixed
 * vocabularies, and a category derived from them. Never throws.
 */

export type BudgetEvent =
  | 'reservation_failed'
  | 'settlement_failed'
  | 'run_identity_missing'
  | 'expiry_failed'
  | 'expiry_sweep_failed'
  | 'expiry_swept'

export type UsageEvent = 'ledger_write_delayed' | 'ledger_write_failed'

export type FailureReason =
  | 'db_timeout'
  | 'db_unavailable'
  | 'db_schema_missing'
  | 'db_constraint'
  | 'db_conflict'
  | 'estimate_failed'
  | 'unknown'

export type BudgetEventFields = {
  callId?: string | null
  invocationId?: string | null
  operationKind?: string | null
  operationId?: string | null
  feature?: string | null
  provider?: string | null
  model?: string | null
  agencyId?: number | null
  reason?: FailureReason
  stage?: 'estimate' | 'database'
  attempts?: number
  /** Counts and timings — never content. */
  rows?: number
  waitedMs?: number
  stale?: number
  settled?: number
  failed?: number
  error?: unknown
}

const TIMEOUT = new Set(['57014', 'ETIMEDOUT'])
const UNAVAILABLE = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EPIPE',
  '08000',
  '08001',
  '08003',
  '08004',
  '08006',
  '53300',
  '57P01',
  '57P02',
  '57P03',
])
const SCHEMA = new Set(['42P01', '42703', '3F000'])
const CONFLICT = new Set(['40001', '40P01', '55P03'])

const safeName = (err: unknown): string | null => {
  const n = (err as { name?: unknown })?.name
  return typeof n === 'string' && /^[A-Za-z_][\w.]{0,63}$/.test(n) ? n : null
}
/** A SQLSTATE (5 chars) or a Node errno code — a code, never data. */
const safeCode = (err: unknown): string | null => {
  const c = (err as { code?: unknown })?.code
  return typeof c === 'string' && /^[A-Z0-9_]{2,20}$/.test(c) ? c : null
}

export function failureReason(err: unknown, stage: 'estimate' | 'database'): FailureReason {
  if (stage === 'estimate') return 'estimate_failed'
  const code = safeCode(err)
  const name = safeName(err)
  if (name === 'KnexTimeoutError' || (code && TIMEOUT.has(code))) return 'db_timeout'
  if (code && UNAVAILABLE.has(code)) return 'db_unavailable'
  if (code && SCHEMA.has(code)) return 'db_schema_missing'
  if (code && CONFLICT.has(code)) return 'db_conflict'
  if (code?.startsWith('23')) return 'db_constraint'
  return 'unknown'
}

const WARN = new Set<string>(['run_identity_missing', 'ledger_write_delayed'])
const INFO = new Set<string>(['expiry_swept'])

export function emitBudgetEvent(evt: BudgetEvent, f: BudgetEventFields): void {
  emitOpsEvent('[ai-budget]', evt, f)
}

export function emitUsageEvent(evt: UsageEvent, f: BudgetEventFields): void {
  emitOpsEvent('[ai-usage]', evt, f)
}

function emitOpsEvent(tag: '[ai-budget]' | '[ai-usage]', evt: BudgetEvent | UsageEvent, f: BudgetEventFields): void {
  try {
    const { error, ...ids } = f
    const line = JSON.stringify({
      evt,
      at: new Date().toISOString(),
      ...ids,
      agencyId: f.agencyId ?? null,
      tenantKnown: f.agencyId != null,
      ...(error !== undefined ? { errorName: safeName(error), errorCode: safeCode(error) } : {}),
    })
    if (INFO.has(evt)) console.info(tag, line)
    else if (WARN.has(evt)) console.warn(tag, line)
    else console.error(tag, line)
  } catch {
    /* observability is best-effort */
  }
}
