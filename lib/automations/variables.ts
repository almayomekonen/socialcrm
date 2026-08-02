/**
 * The closed variable set for automation email content (spec §7) — the
 * WhatsApp-templates precedent (Hebrew token → field), extended with the
 * assigned rep. No free-form variables, no field-mapping UI. Rendering and
 * fallback behavior ("שלום דנה," → "שלום,") are Phase 4; this module owns the
 * vocabulary and catalog validation.
 *
 * Per ADR-007 there are NO event-date variables in V1.
 */
export const AUTOMATION_EMAIL_VARIABLES = [
  { token: 'שם הליד', field: 'leadFirstName', defaultSample: 'דוד' },
  { token: 'שם העסק', field: 'businessName', defaultSample: 'העסק שלי' },
  { token: 'שם הנציג', field: 'repName', defaultSample: 'נציג העסק' },
] as const

/**
 * B3: the Builder's variable chips are derived from the SELECTED EVENT's
 * declared fields, intersected with the keys the renderer can resolve. Adding
 * a renderable field to an event adds a chip with no Builder change.
 *
 * The intersection exists because the renderer's value record is a typed
 * struct; widening it to arbitrary fields is action-executor work (B5+), not
 * Builder work. Until then a field the renderer cannot substitute is not
 * offered as a chip — the alternative would be a chip that renders as a raw
 * token in a real email.
 */
export function variableChipsForEvent(fields: readonly { key: string; label: string }[]) {
  const resolvable = new Set<string>(AUTOMATION_EMAIL_VARIABLES.map((v) => v.field))
  return fields.filter((f) => resolvable.has(f.key)).map((f) => ({ token: f.label, field: f.key }))
}

export type AutomationEmailVariable = (typeof AUTOMATION_EMAIL_VARIABLES)[number]

const TOKEN_RE = /\{\{([^{}]+)\}\}/g

/** All {{...}} tokens appearing in a piece of content, trimmed. */
export function listTokens(content: string): string[] {
  const out: string[] = []
  for (let m = TOKEN_RE.exec(content); m; m = TOKEN_RE.exec(content)) out.push(m[1].trim())
  return out
}

/** Tokens in content that are not part of the closed set (catalog guard). */
export function unknownTokens(content: string): string[] {
  const known = new Set<string>(AUTOMATION_EMAIL_VARIABLES.map((v) => v.token))
  return listTokens(content).filter((t) => !known.has(t))
}

export type EmailVariableValues = {
  leadFirstName: string | null
  businessName: string | null
  repName: string | null
}

const TOKEN_TO_FIELD: Array<{ token: string; field: keyof EmailVariableValues }> = [
  { token: 'שם הליד', field: 'leadFirstName' },
  { token: 'שם העסק', field: 'businessName' },
  { token: 'שם הנציג', field: 'repName' },
]

/**
 * Substitution with graceful fallbacks (spec §7): an empty first name turns
 * "שלום דנה," into "שלום," rather than leaving a hole or a raw token.
 *
 * Lives here — pure and dependency-free — so the server renderer and the
 * client-side preview share ONE implementation. A preview that substituted
 * differently from the real send would be a lie.
 */
export function substituteVariables(content: string, vars: EmailVariableValues): string {
  let out = content
  const business = vars.businessName?.trim() || 'העסק'
  const resolved: Record<keyof EmailVariableValues, string> = {
    leadFirstName: vars.leadFirstName?.trim() || '',
    businessName: business,
    repName: vars.repName?.trim() || business,
  }
  for (const { token, field } of TOKEN_TO_FIELD) {
    out = out.split(`{{${token}}}`).join(resolved[field])
  }
  return out
    .replace(/ +,/g, ',')
    .replace(/[^\S\n]{2,}/g, ' ')
    .replace(/[^\S\n]+$/gm, '')
}
