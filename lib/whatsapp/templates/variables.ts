/**
 * Send-time variable resolution (RFC §10). Pure.
 *
 * At send time each friendly chip in an approved template is resolved to a real
 * CRM value and emitted as a positional Meta parameter. Two hard rules live here:
 *
 *  1. **Order matches `buildComponents`.** Meta's `{{1}},{{2}}…` are ordered by the
 *     token's first appearance in the body; the params array MUST use the same
 *     order or the arity/positions drift and Meta rejects the send.
 *  2. **No empty parameter, ever.** Meta rejects a send with an empty parameter, so
 *     every value has a guaranteed non-empty fallback (the same discipline as the
 *     single-word `lastName` hotfix — no empty value reaches Meta).
 */
import { TEMPLATE_VARIABLES } from './messages'
import type { TemplateVariable } from './types'

/** Guaranteed non-empty fallbacks per closed-set field. */
export const TEMPLATE_VALUE_FALLBACK: Record<string, string> = {
  leadFirstName: 'שלום',
  businessName: 'העסק',
}

/** Last-resort value if a field is unknown or its fallback is somehow empty. */
const HARD_FALLBACK = 'שלום'

/** token → CRM field, from the single closed-set source of truth. */
const FIELD_BY_TOKEN: Record<string, string> = Object.fromEntries(
  TEMPLATE_VARIABLES.map((v) => [v.token, v.field as string]),
)

export type TemplateValueContext = {
  leadFullName: string | null | undefined
  businessName: string | null | undefined
}

/** First whitespace-delimited part of a full name; '' when the name is empty. */
export function firstNameOf(fullName: string | null | undefined): string {
  const t = String(fullName ?? '').trim()
  return t ? t.split(/\s+/)[0] : ''
}

/** Resolve one closed-set field to a guaranteed non-empty value. */
export function resolveFieldValue(field: string, ctx: TemplateValueContext): string {
  let raw = ''
  if (field === 'leadFirstName') raw = firstNameOf(ctx.leadFullName)
  else if (field === 'businessName') raw = String(ctx.businessName ?? '').trim()
  const val = raw.trim()
  if (val) return val
  return TEMPLATE_VALUE_FALLBACK[field] ?? HARD_FALLBACK
}

/**
 * The variables actually present in the body, ordered by first appearance — this
 * MUST mirror `buildComponents` so param positions line up with the approved
 * template's `{{n}}` placeholders.
 */
function presentInOrder(bodyText: string, variables: TemplateVariable[]): TemplateVariable[] {
  const body = bodyText ?? ''
  return (variables ?? [])
    .filter((v) => body.includes(v.token))
    .sort((a, b) => body.indexOf(a.token) - body.indexOf(b.token))
}

/** Positional Meta params (`{{1}},{{2}}…` order), each guaranteed non-empty. */
export function resolveTemplateParams(
  bodyText: string,
  variables: TemplateVariable[],
  ctx: TemplateValueContext,
): string[] {
  return presentInOrder(bodyText, variables).map((v) => {
    const field = FIELD_BY_TOKEN[v.token]
    const val = field ? resolveFieldValue(field, ctx) : v.sample
    const s = String(val ?? '').trim()
    return s || HARD_FALLBACK
  })
}

/**
 * The body with every token substituted by its resolved value — the human-readable
 * text persisted to the conversation (so the thread shows what the lead received).
 */
export function renderResolvedBody(
  bodyText: string,
  variables: TemplateVariable[],
  ctx: TemplateValueContext,
): string {
  let text = bodyText ?? ''
  for (const v of variables ?? []) {
    const field = FIELD_BY_TOKEN[v.token]
    const val = field ? resolveFieldValue(field, ctx) : v.sample
    text = text.split(v.token).join(String(val ?? ''))
  }
  return text.trim()
}
