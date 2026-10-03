import 'server-only'
import { db } from '@/config/db'

/**
 * mcp_audit_events: one row per MCP tool call.
 *
 * sanitizeParams keeps only what is safe and useful for an audit trail: ids,
 * limits and booleans, plus the values of a FIXED set of enum fields when they
 * look like enum values. Every other string — search text, message text, names,
 * phone numbers, anything — is stored as {len} only. Key names must look like
 * identifiers (an attacker-chosen key is dropped), and size is capped.
 */
const ENUM_KEYS = new Set(['status', 'bucket', 'intent'])
const ENUM_VALUE_RE = /^[a-z_]{1,32}$/
const KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,39}$/
const MAX_KEYS = 20
const MAX_ARRAY = 10
const MAX_ABS_NUMBER = 1e12

function clean(key: string, v: unknown): unknown {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return Number.isFinite(v) && Math.abs(v) <= MAX_ABS_NUMBER ? v : undefined
  if (typeof v === 'string') return ENUM_KEYS.has(key) && ENUM_VALUE_RE.test(v) ? v : { len: v.length }
  return undefined
}

export function sanitizeParams(params: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!params || typeof params !== 'object' || Array.isArray(params)) return out
  for (const [k, v] of Object.entries(params)) {
    if (Object.keys(out).length >= MAX_KEYS) break
    if (!KEY_RE.test(k)) continue
    if (Array.isArray(v)) {
      out[k] = v
        .slice(0, MAX_ARRAY)
        .map((x) => clean(k, x))
        .filter((x) => x !== undefined)
    } else {
      const c = clean(k, v)
      if (c !== undefined) out[k] = c
    }
  }
  return out
}

export type AuditRow = {
  requestId: string
  agencyId: number
  userId: number
  grantId: number
  clientId: string
  tool: string
  targetType?: 'lead' | 'conversation'
  targetId?: number
  params: Record<string, unknown>
  outcome: string
  resultCount?: number
  durationMs: number
}

const sourceOf = (clientId: string): string => {
  try {
    return new URL(clientId).hostname === 'chatgpt.com' ? 'chatgpt' : 'other'
  } catch {
    return 'other'
  }
}

/** Throws on failure — the caller decides fail-open vs fail-closed (see runTool). */
export async function writeAudit(r: AuditRow): Promise<void> {
  await db('mcp_audit_events').insert({
    request_id: r.requestId,
    agency_id: r.agencyId,
    user_id: r.userId,
    grant_id: r.grantId,
    client_id: r.clientId,
    source: sourceOf(r.clientId),
    tool: r.tool,
    kind: 'read',
    target_type: r.targetType ?? null,
    target_id: r.targetId ?? null,
    params: JSON.stringify(sanitizeParams(r.params)),
    outcome: r.outcome,
    result_count: r.resultCount ?? null,
    duration_ms: Math.max(0, Math.round(r.durationMs)),
  })
}
