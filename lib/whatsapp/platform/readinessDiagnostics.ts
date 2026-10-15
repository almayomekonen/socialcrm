import type { ReadinessCheck } from './readiness'

/**
 * Read-only diagnostics added to readiness check details, so a failure says
 * WHY without exposing anything sensitive. They never change a check's `ok`.
 *
 *   healthEntities   each health_status entity that is LIMITED or BLOCKED:
 *                    entity type, its can_send_message, numeric error codes.
 *                    No entity ids, no error_description, no additional_info.
 *   error meta       Graph error subcode, type and fbtrace_id (Meta's opaque
 *                    trace id for support tickets). Never the error message.
 *   grants           whether a scope is granted on the configured WABA, from
 *                    debug_token granular_scopes: GRANTED (the WABA is in
 *                    target_ids), NOT_GRANTED (scope absent, or target_ids
 *                    without the WABA) or UNKNOWN (the scope carries no
 *                    target_ids, so nothing proves the WABA is assigned).
 *   tokenUserId      debug_token's user_id (the System User the token belongs
 *                    to), only as a 5-20 digit string. Not a secret.
 *
 * Every value is sanitized here as well as in the view (defence in depth).
 */

const ENTITY = /^[A-Z][A-Z_]{0,39}$/
const ERROR_TYPE = /^[A-Za-z][A-Za-z0-9_]{0,39}$/
const TRACE_ID = /^[A-Za-z0-9_-]{6,64}$/

export type HealthEntityDiagnostic = { entity: string; canSendMessage: 'LIMITED' | 'BLOCKED'; errorCodes: number[] }

export function healthEntityDiagnostics(health: unknown): HealthEntityDiagnostic[] {
  const entities = ((health as { entities?: unknown } | null)?.entities ?? []) as unknown[]
  if (!Array.isArray(entities)) return []
  const out: HealthEntityDiagnostic[] = []
  for (const raw of entities) {
    const e = (raw ?? {}) as { entity_type?: unknown; can_send_message?: unknown; errors?: unknown }
    if (e.can_send_message !== 'LIMITED' && e.can_send_message !== 'BLOCKED') continue
    const entity = typeof e.entity_type === 'string' && ENTITY.test(e.entity_type) ? e.entity_type : 'UNEXPECTED'
    const errorCodes = (Array.isArray(e.errors) ? e.errors : [])
      .map((x) => (x as { error_code?: unknown })?.error_code)
      .filter((c): c is number => typeof c === 'number' && Number.isSafeInteger(c))
    out.push({ entity, canSendMessage: e.can_send_message, errorCodes })
  }
  return out
}

export function graphErrorMeta(body: unknown): { errorSubcode: number | null; errorType: string | null; fbtraceId: string | null } {
  const err = ((body as { error?: unknown } | null)?.error ?? null) as { error_subcode?: unknown; type?: unknown; fbtrace_id?: unknown } | null
  return {
    errorSubcode: typeof err?.error_subcode === 'number' && Number.isSafeInteger(err.error_subcode) ? err.error_subcode : null,
    errorType: typeof err?.type === 'string' && ERROR_TYPE.test(err.type) ? err.type : null,
    fbtraceId: typeof err?.fbtrace_id === 'string' && TRACE_ID.test(err.fbtrace_id) ? err.fbtrace_id : null,
  }
}

const USER_ID = /^\d{5,20}$/

/** debug_token's user_id as a digits-only string, else null. Nothing else from the token's data. */
export function tokenUserIdFrom(userId: unknown): string | null {
  const v = typeof userId === 'number' && Number.isSafeInteger(userId) && userId > 0 ? String(userId) : userId
  return typeof v === 'string' && USER_ID.test(v) ? v : null
}

export type WabaGrant = 'GRANTED' | 'NOT_GRANTED' | 'UNKNOWN'

/**
 * Whether `scope` is granted on `wabaId`. A scope without a target_ids list is
 * UNKNOWN, never GRANTED: its absence does not show the WABA is assigned to
 * the token's System User.
 */
export function scopeGrantOnWaba(granularScopes: unknown, scope: string, wabaId: string): WabaGrant {
  if (!Array.isArray(granularScopes)) return 'UNKNOWN'
  const grant = (granularScopes as { scope?: unknown; target_ids?: unknown }[]).find((g) => g?.scope === scope)
  if (!grant) return 'NOT_GRANTED'
  if (!Array.isArray(grant.target_ids)) return 'UNKNOWN'
  return grant.target_ids.map(String).includes(wabaId) ? 'GRANTED' : 'NOT_GRANTED'
}

/**
 * Adds diagnostics to the phone and template checks after their `ok` was
 * decided. Only detail fields are added; nothing is removed or re-evaluated.
 */
export function attachReadinessDiagnostics(
  checks: ReadinessCheck[],
  responses: { phone?: { status: number; body: unknown }; template?: { status: number; body: unknown } },
): void {
  const phone = checks.find((c) => c.name === 'phone')
  if (phone && responses.phone) {
    if (responses.phone.status === 200) phone.detail = { ...phone.detail, healthEntities: healthEntityDiagnostics((responses.phone.body as { health_status?: unknown } | null)?.health_status) }
    else phone.detail = { ...phone.detail, ...graphErrorMeta(responses.phone.body) }
  }
  const template = checks.find((c) => c.name === 'template')
  if (template && responses.template && responses.template.status !== 200) {
    template.detail = { ...template.detail, ...graphErrorMeta(responses.template.body) }
  }
}
