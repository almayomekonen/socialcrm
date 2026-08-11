/**
 * The one place Support decides what may leave the server.
 *
 * ALLOWLIST, never denylist. A column added to automation_connections next year
 * is invisible to support by default, which is the only version of this rule
 * that survives a schema nobody here will be reviewing.
 *
 * The customer must never meet an internal concept — no secret, no token, no
 * database identifier, no internal error code. Neither must the platform owner
 * meet one it does not need: a support conversation is not a debugger.
 */

export const FORBIDDEN_KEY_PATTERN =
  /secret|token|password|credential|apikey|api_key|sessionversion/i

const MAX_ERROR_CHARS = 200
const MAX_SCAN_DEPTH = 8

/**
 * Deep scan used by tests and by the notify layer's assertions.
 *
 * Depth-capped rather than cycle-tracked: the cap terminates on a cyclic object
 * without the cost of a WeakSet, and nothing this scans is legitimately deeper
 * than a few levels.
 */
export function containsForbiddenKey(value: unknown, depth = 0): boolean {
  if (depth > MAX_SCAN_DEPTH || value === null || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.some((v) => containsForbiddenKey(v, depth + 1))
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEY_PATTERN.test(k)) return true
    if (containsForbiddenKey(v, depth + 1)) return true
  }
  return false
}

/**
 * Build a FRESH object from the named keys.
 *
 * Deliberately not spread-and-delete: deletion fails OPEN when a new field
 * appears, projection fails CLOSED. `hasOwnProperty` so an inherited or
 * prototype-polluted key can never be projected.
 */
export function projectAllowed<T extends Record<string, unknown>>(
  row: T,
  allowed: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of allowed) {
    if (row != null && Object.prototype.hasOwnProperty.call(row, key)) out[key] = row[key]
  }
  return out
}

/**
 * Transport error text, made safe to log.
 *
 * Resend's messages describe transport state and do not echo payloads — but
 * "do not" is an assumption, and this makes it a guarantee.
 */
export function safeErrorMetadata(err: unknown): string {
  const raw = (err as { message?: string })?.message
  if (typeof raw !== 'string' || raw.length === 0) return 'unknown_error'
  const scrubbed = raw.replace(
    /(secret|token|password|credential|api[_-]?key)\s*[=:]\s*\S+/gi,
    '$1=[redacted]',
  )
  return scrubbed.slice(0, MAX_ERROR_CHARS)
}

/**
 * Per-context-kind column allowlists. A resolver may project ONLY these.
 *
 * Populated in Phase 4 alongside the resolvers they govern; empty here so that
 * nothing can be projected before the rules for it exist.
 */
export const SUPPORT_SAFE_FIELDS: Record<string, readonly string[]> = {}
