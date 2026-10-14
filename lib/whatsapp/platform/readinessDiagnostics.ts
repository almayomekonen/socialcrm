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
 *   management       whether whatsapp_business_management is granted on the
 *                    configured WABA (granular_scopes target list).
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

/** True only when whatsapp_business_management is granted with no target restriction or with the WABA among its targets. */
export function managementGrantedOnWaba(granularScopes: unknown, wabaId: string): boolean {
  const list = (Array.isArray(granularScopes) ? granularScopes : []) as { scope?: unknown; target_ids?: unknown }[]
  const management = list.find((g) => g?.scope === 'whatsapp_business_management')
  if (!management) return false
  return !Array.isArray(management.target_ids) || management.target_ids.map(String).includes(wabaId)
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
