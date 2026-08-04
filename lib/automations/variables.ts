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
  /**
   * The meeting an appointment occurrence is about. Offered as chips ONLY on
   * events that declare these fields — `variableChipsForEvent` intersects the
   * event's fields with what the renderer can resolve, so a lead automation
   * never sees them.
   *
   * `פרטי הפגישה` is one resolved multi-line block rather than separate location
   * and link tokens: both are optional in the data, and a template line reading
   * "מקום: {{...}}" with nothing to fill renders a dangling label. A block that
   * omits the line cannot.
   */
  { token: 'שם הפגישה', field: 'meetingTitle', defaultSample: 'פגישת היכרות' },
  { token: 'מועד הפגישה', field: 'meetingWhen', defaultSample: 'יום שלישי, 12 באוגוסט, 10:30' },
  { token: 'פרטי הפגישה', field: 'meetingDetails', defaultSample: 'פגישת היכרות\nיום שלישי, 12 באוגוסט, 10:30' },
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

/**
 * Tokens in content that the given ACTION cannot resolve.
 *
 * B6b makes this action-driven: the caller passes the field keys the chosen
 * action's executor declares it can substitute, and validation is against
 * those. Passing nothing means "nothing is resolvable", so an unregistered
 * action's content is rejected rather than silently validated against email's
 * vocabulary.
 */
export function unknownTokensFor(resolvableFields: readonly string[], content: string): string[] {
  const resolvable = new Set(resolvableFields)
  const known = new Set(TOKEN_TO_FIELD.filter((t) => resolvable.has(t.field)).map((t) => t.token))
  return listTokens(content).filter((t) => !known.has(t))
}

/** The token↔field vocabulary, for callers that need to name one. */
export const variableTokenFor = (field: string): string | null => TOKEN_TO_FIELD.find((t) => t.field === field)?.token ?? null

/**
 * B6b: a generic map keyed by SUBJECT FIELD KEY, not a typed email struct.
 * An executor hands in whatever its `resolvableFields` resolved to, and the
 * substituter neither knows nor cares which action it is serving.
 */
export type VariableValues = Record<string, string | null>

/** Retained name for the shipped call sites; now just the generic map. */
export type EmailVariableValues = VariableValues

const TOKEN_TO_FIELD: Array<{ token: string; field: string }> = AUTOMATION_EMAIL_VARIABLES.map((v) => ({
  token: v.token,
  field: v.field,
}))

/**
 * Substitution with graceful fallbacks (spec §7): an empty first name turns
 * "שלום דנה," into "שלום," rather than leaving a hole or a raw token.
 *
 * Lives here — pure and dependency-free — so the server renderer and the
 * client-side preview share ONE implementation. A preview that substituted
 * differently from the real send would be a lie.
 */
export function substituteVariables(content: string, vars: VariableValues): string {
  // Adjacent tokens are separated BEFORE substitution. `{{שם העסק}}{{שם העסק}}`
  // rendered as "סטודיו אורסטודיו אור" — the tripled, run-together business name
  // seen in production, caused by inserting a variable chip while the caret sat
  // against another one. Repaired here rather than in the renderer so the
  // Builder preview and the real send agree.
  let out = content.replace(/\}\}(?=\{\{)/g, '}} ')
  const business = vars.businessName?.trim() || 'העסק'

  /**
   * Resolved from the VOCABULARY, not from a hand-written list of fields.
   *
   * The list form silently dropped any token added to the closed set but not to
   * it — the meeting tokens rendered as empty strings while every unit test
   * passed, because each tested substitution in isolation. Deriving from
   * `TOKEN_TO_FIELD` makes "add a token, get a substitution" true instead of
   * something to remember.
   *
   * Two fields keep their special fallbacks; everything else resolves to its
   * value or to nothing.
   */
  const value = (field: string): string => {
    if (field === 'businessName') return business
    // A rep-less business signs as itself rather than as an empty space.
    if (field === 'repName') return vars.repName?.trim() || business
    // An absent first name degrades "שלום דנה," to "שלום," via the comma rule below.
    return String(vars[field] ?? '').trim()
  }

  for (const { token, field } of TOKEN_TO_FIELD) {
    out = out.split(`{{${token}}}`).join(value(field))
  }
  return out
    .replace(/ +,/g, ',')
    .replace(/[^\S\n]{2,}/g, ' ')
    .replace(/[^\S\n]+$/gm, '')
}
