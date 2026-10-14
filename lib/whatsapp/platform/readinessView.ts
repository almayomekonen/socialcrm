import type { ReadinessCheck } from './readiness'

/**
 * What the platform-owner readiness page may render: an explicit allowlist of
 * fields per check, each coerced to a safe shape. Anything else in a check's
 * detail (and any field added to readiness later) is dropped, so no token,
 * secret, raw Meta response or Meta error message can reach the page.
 *
 *   strings   only enum-like values (A–Z, 0–9, _), else 'UNEXPECTED'
 *   numbers   only safe integers
 *   scopes    reduced to two booleans for the two required permissions
 *   errors    HTTP status and Meta error code only, never the message
 *
 * Pure: no I/O.
 */

export type ReadinessFieldValue = boolean | number | string
export type ReadinessViewField = { key: string; label: string; value: ReadinessFieldValue }
export type ReadinessViewCheck = { name: ReadinessCheck['name']; label: string; ok: boolean; fields: ReadinessViewField[] }
export type ReadinessView = { ready: boolean; checks: ReadinessViewCheck[] }

const CHECK_LABEL: Record<ReadinessCheck['name'], string> = {
  config: 'הגדרות בשרת',
  token: 'טוקן הגישה',
  phone: 'מספר הטלפון',
  template: 'תבנית lead_followup_alert',
}

const ENUM = /^[A-Z][A-Z0-9_]{0,39}$/
const asEnum = (v: unknown): string | null => (v == null ? null : typeof v === 'string' && ENUM.test(v) ? v : 'UNEXPECTED')
const asBool = (v: unknown): boolean | null => (v === true ? true : v === false ? false : null)
const asInt = (v: unknown): number | null => (typeof v === 'number' && Number.isSafeInteger(v) ? v : null)
const has = (scopes: unknown, scope: string): boolean | null => (Array.isArray(scopes) ? scopes.includes(scope) : null)

type Spec = { key: string; label: string; read: (d: Record<string, unknown>) => ReadinessFieldValue | null }

const errorFields: Spec[] = [
  { key: 'httpStatus', label: 'סטטוס HTTP מ-Meta', read: (d) => asInt(d.httpStatus) },
  { key: 'code', label: 'קוד שגיאה מ-Meta', read: (d) => asInt(d.code) },
]

const SPECS: Record<ReadinessCheck['name'], Spec[]> = {
  config: [
    { key: 'phoneNumberId', label: 'מזהה מספר טלפון מוגדר', read: (d) => asBool(d.phoneNumberId) },
    { key: 'wabaId', label: 'מזהה חשבון WhatsApp מוגדר', read: (d) => asBool(d.wabaId) },
    { key: 'accessToken', label: 'טוקן גישה מוגדר', read: (d) => asBool(d.accessToken) },
    { key: 'appId', label: 'מזהה אפליקציה מוגדר', read: (d) => asBool(d.appId) },
    { key: 'appSecret', label: 'סוד אפליקציה מוגדר', read: (d) => asBool(d.appSecret) },
    { key: 'sendEnabled', label: 'שליחה מופעלת', read: (d) => asBool(d.sendEnabled) },
    { key: 'allowlistedAgencyCount', label: 'סוכנויות ברשימת ההיתר', read: (d) => (Array.isArray(d.allowlistedAgencies) ? d.allowlistedAgencies.length : null) },
  ],
  token: [
    { key: 'isValid', label: 'טוקן תקף', read: (d) => asBool(d.isValid) },
    { key: 'type', label: 'סוג טוקן', read: (d) => asEnum(d.type) },
    { key: 'appMatches', label: 'שייך לאפליקציה הנכונה', read: (d) => asBool(d.appMatches) },
    { key: 'neverExpires', label: 'ללא תפוגה', read: (d) => asBool(d.neverExpires) },
    { key: 'hasMessagingScope', label: 'הרשאת whatsapp_business_messaging', read: (d) => has(d.scopes, 'whatsapp_business_messaging') },
    { key: 'hasManagementScope', label: 'הרשאת whatsapp_business_management', read: (d) => has(d.scopes, 'whatsapp_business_management') },
    { key: 'messagingGrantedOnWaba', label: 'הרשאת שליחה על חשבון ה-WhatsApp', read: (d) => asBool(d.messagingGrantedOnWaba) },
    ...errorFields,
  ],
  phone: [
    { key: 'status', label: 'סטטוס', read: (d) => asEnum(d.status) },
    { key: 'qualityRating', label: 'דירוג איכות', read: (d) => asEnum(d.qualityRating) },
    { key: 'canSendMessage', label: 'יכולת שליחה (health_status)', read: (d) => asEnum(d.canSendMessage) },
    { key: 'nameStatus', label: 'סטטוס שם תצוגה', read: (d) => asEnum(d.nameStatus) },
    { key: 'messagingLimitTier', label: 'מגבלת שליחה', read: (d) => asEnum(d.messagingLimitTier) },
    ...errorFields,
  ],
  template: [
    { key: 'found', label: 'נמצאה בעברית', read: (d) => (d.found === false ? false : d.status != null ? true : null) },
    { key: 'status', label: 'סטטוס', read: (d) => asEnum(d.status) },
    { key: 'category', label: 'קטגוריה', read: (d) => asEnum(d.category) },
    { key: 'bodyVariables', label: 'משתנים בגוף ההודעה', read: (d) => asInt(d.bodyVariables) },
    { key: 'urlButtonHasVariable', label: 'כפתור קישור דינמי', read: (d) => asBool(d.urlButtonHasVariable) },
    ...errorFields,
  ],
}

export function toReadinessView(result: { ready?: unknown; checks?: unknown }): ReadinessView {
  const checks: ReadinessViewCheck[] = []
  for (const raw of Array.isArray(result?.checks) ? (result.checks as ReadinessCheck[]) : []) {
    const name = raw?.name
    if (!name || !(name in SPECS)) continue
    const detail = (raw.detail && typeof raw.detail === 'object' ? raw.detail : {}) as Record<string, unknown>
    const fields: ReadinessViewField[] = []
    for (const spec of SPECS[name]) {
      const value = spec.read(detail)
      if (value !== null) fields.push({ key: spec.key, label: spec.label, value })
    }
    checks.push({ name, label: CHECK_LABEL[name], ok: raw.ok === true, fields })
  }
  return { ready: result?.ready === true && checks.length > 0 && checks.every((c) => c.ok), checks }
}
