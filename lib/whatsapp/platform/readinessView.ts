import type { ReadinessCheck } from './readiness'
import { tokenUserNameFrom } from './readinessDiagnostics'

/**
 * What the platform-owner readiness page may render: an explicit allowlist of
 * fields per check, each coerced to a safe shape. Anything else in a check's
 * detail (and any field added to readiness later) is dropped, so no token,
 * secret, raw Meta response or Meta error message can reach the page.
 *
 *   strings   only enum-like values (A–Z, 0–9, _), else 'UNEXPECTED'
 *   numbers   only safe integers
 *   scopes    reduced to two booleans for the two required permissions;
 *             WABA grants only as GRANTED / NOT_GRANTED / UNKNOWN
 *   user id   the token's System User id, digits only (not a secret); from
 *             /me its id (digits) and name (allowlisted characters only), or
 *             only HTTP status, code and subcode when /me fails
 *   errors    HTTP status, Meta error code, subcode, type and trace id; never
 *             the message
 *   health    each LIMITED/BLOCKED health entity as "STATUS (codes)": entity
 *             type, status and numeric codes only; no ids, no provider text
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
const ERROR_TYPE = /^[A-Za-z][A-Za-z0-9_]{0,39}$/
const TRACE_ID = /^[A-Za-z0-9_-]{6,64}$/
const ENTITY = /^[A-Z][A-Z_]{0,39}$/
const asPattern = (re: RegExp) => (v: unknown): string | null => (typeof v === 'string' && re.test(v) ? v : null)
const has = (scopes: unknown, scope: string): boolean | null => (Array.isArray(scopes) ? scopes.includes(scope) : null)
const GRANTS = ['GRANTED', 'NOT_GRANTED', 'UNKNOWN']
const USER_ID = /^\d{5,20}$/
const asGrant = (v: unknown): string | null => (v == null ? null : typeof v === 'string' && GRANTS.includes(v) ? v : 'UNEXPECTED')

type Spec = { key: string; label: string; read: (d: Record<string, unknown>) => ReadinessFieldValue | null }

const errorFields: Spec[] = [
  { key: 'httpStatus', label: 'סטטוס HTTP מ-Meta', read: (d) => asInt(d.httpStatus) },
  { key: 'code', label: 'קוד שגיאה מ-Meta', read: (d) => asInt(d.code) },
  { key: 'errorSubcode', label: 'קוד משנה מ-Meta', read: (d) => asInt(d.errorSubcode) },
  { key: 'errorType', label: 'סוג שגיאה מ-Meta', read: (d) => asPattern(ERROR_TYPE)(d.errorType) },
  { key: 'fbtraceId', label: 'מזהה מעקב של Meta', read: (d) => asPattern(TRACE_ID)(d.fbtraceId) },
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
    { key: 'tokenUserId', label: 'מזהה System User של הטוקן', read: (d) => asPattern(USER_ID)(d.tokenUserId) },
    { key: 'tokenMeId', label: 'מזהה הטוקן לפי /me', read: (d) => asPattern(USER_ID)(d.tokenMeId) },
    { key: 'tokenUserName', label: 'שם ה-System User לפי /me', read: (d) => tokenUserNameFrom(d.tokenUserName) },
    { key: 'meHttpStatus', label: 'סטטוס HTTP של /me', read: (d) => asInt(d.meHttpStatus) },
    { key: 'meCode', label: 'קוד שגיאה של /me', read: (d) => asInt(d.meCode) },
    { key: 'meErrorSubcode', label: 'קוד משנה של /me', read: (d) => asInt(d.meErrorSubcode) },
    { key: 'hasMessagingScope', label: 'הרשאת whatsapp_business_messaging', read: (d) => has(d.scopes, 'whatsapp_business_messaging') },
    { key: 'hasManagementScope', label: 'הרשאת whatsapp_business_management', read: (d) => has(d.scopes, 'whatsapp_business_management') },
    { key: 'messagingGrantedOnWaba', label: 'הרשאת שליחה על חשבון ה-WhatsApp', read: (d) => asGrant(d.messagingGrantedOnWaba) },
    { key: 'managementGrantedOnWaba', label: 'הרשאת ניהול על חשבון ה-WhatsApp', read: (d) => asGrant(d.managementGrantedOnWaba) },
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
    if (name === 'phone') fields.push(...healthEntityFields(detail.healthEntities))
    checks.push({ name, label: CHECK_LABEL[name], ok: raw.ok === true, fields })
  }
  return { ready: result?.ready === true && checks.length > 0 && checks.every((c) => c.ok), checks }
}

/** Each LIMITED/BLOCKED health entity as one field: "BLOCKED (141006)". Entity type, status and integer codes only. */
function healthEntityFields(raw: unknown): ReadinessViewField[] {
  return (Array.isArray(raw) ? raw : []).slice(0, 10).flatMap((e, i) => {
    const entity = (e as { entity?: unknown })?.entity
    const status = (e as { canSendMessage?: unknown })?.canSendMessage
    if (status !== 'LIMITED' && status !== 'BLOCKED') return []
    const codes = ((e as { errorCodes?: unknown })?.errorCodes ?? []) as unknown[]
    const ints = (Array.isArray(codes) ? codes : []).filter((c): c is number => typeof c === 'number' && Number.isSafeInteger(c)).slice(0, 10)
    const name = typeof entity === 'string' && ENTITY.test(entity) ? entity : 'UNEXPECTED'
    return [{ key: `health_${i}`, label: `מצב שליחה: ${name}`, value: ints.length ? `${status} (${ints.join(', ')})` : status }]
  })
}
