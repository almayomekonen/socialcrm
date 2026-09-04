/**
 * Turn a Postgres driver error into a SHORT, PII-FREE diagnostic string.
 *
 * Why this exists: `insertLeadSystem` used to swallow the driver error into
 * `console.error` and return null, so `webhook_failures.error_detail` was empty
 * and every dropped lead read `createLeadFromWebhook returned null` — the same
 * sentence for a unique-constraint rejection, an FK violation and a dead
 * connection. 18 production failures could not be told apart. Root-causing them
 * required inference instead of a lookup.
 *
 * PII IS DELIBERATELY DROPPED. `err.detail` from Postgres reads
 * `Key (phone)=(9725xxxxxxx) already exists.` — it names the constraint AND the
 * customer's phone number or email. That value is exactly what we must not
 * persist into a diagnostics table, so `detail` is never copied through. The
 * constraint name plus SQLSTATE identifies the failure completely for
 * engineering purposes without retaining a single personal value.
 */

type PgLikeError = {
  code?: unknown
  constraint?: unknown
  table?: unknown
  column?: unknown
  routine?: unknown
  message?: unknown
}

/** Only these keys are read; nothing else from the driver error is trusted. */
function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 && v.length <= 200 ? v : null
}

export type DbErrorInfo = {
  /** SQLSTATE, e.g. '23505' unique_violation, '23503' foreign_key_violation. */
  code: string | null
  /** e.g. 'clients_agency_phone_unique'. The single most useful field. */
  constraint: string | null
  table: string | null
  column: string | null
  /** Compact, PII-free one-liner for `webhook_failures.error_detail`. */
  summary: string
}

export function describeDbError(err: unknown): DbErrorInfo {
  const e = (err ?? {}) as PgLikeError
  const code = str(e.code)
  const constraint = str(e.constraint)
  const table = str(e.table)
  const column = str(e.column)

  const parts: string[] = []
  if (code) parts.push(`sqlstate=${code}`)
  if (constraint) parts.push(`constraint=${constraint}`)
  if (table) parts.push(`table=${table}`)
  if (column) parts.push(`column=${column}`)

  // Fall back to the driver's message ONLY when nothing structured is present
  // (e.g. a connection error, which carries no constraint and no PII). A
  // Postgres integrity error always sets `code`, so this branch cannot leak a
  // key value from `detail` — `detail` is never read at all.
  if (parts.length === 0) {
    const message = str(e.message)
    parts.push(message ? `error=${message.slice(0, 160)}` : 'error=unknown')
  }

  return { code, constraint, table, column, summary: parts.join(' ') }
}
