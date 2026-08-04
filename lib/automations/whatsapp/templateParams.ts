import { bodyParameterCount } from '@/lib/whatsapp/templates/parameters'
import { TEMPLATE_VARIABLES } from '@/lib/whatsapp/templates/messages'
import { TEMPLATE_VALUE_FALLBACK } from '@/lib/whatsapp/templates/variables'
import type { TemplateVariable } from '@/lib/whatsapp/templates/types'

/**
 * AUTOMATION → META TEMPLATE PARAMETERS. Pure; no I/O.
 *
 * The audited "adapter, not a rewrite". `resolveTemplateSendParameters` already
 * solves this for a REP sending one message, but its value context is
 * rep-shaped (`{leadFullName, businessName}`) and its binding sources are the
 * rep-facing closed set (`leadFirstName | businessName`). An automation resolves
 * from CATALOG SUBJECT FIELDS instead — a strictly larger set that includes the
 * appointment's meeting — so it needs its own resolution while reusing the two
 * things that are genuinely shared:
 *
 *   · ARITY comes from the template, never from our own chip array — the exact
 *     count Meta approved and will validate against (`bodyParameterCount`).
 *   · UNMAPPED SLOTS BLOCK. A template whose slots we cannot fill is refused
 *     before the send rather than sent with a mismatched count. That is the
 *     `#132000` discipline, and it is the reason this file returns a failure
 *     instead of padding with placeholders.
 *
 * Deliberately NOT done: widening the rep-facing `ParameterSource` set to
 * include meeting fields. That would change the template create/edit surface
 * (chips, samples, Meta examples) for a need that belongs to automations only.
 */

/** token → the CRM field it means, from the rep-facing closed set. */
const FIELD_BY_TOKEN: Record<string, string> = Object.fromEntries(TEMPLATE_VARIABLES.map((v) => [v.token, v.field]))

export type TemplateShape = { bodyText: string; variables: TemplateVariable[] }

/**
 * One positional slot as the Builder must present it.
 *
 * `field` non-null means the slot is ALREADY understood and needs no mapping:
 * a template authored in SocialCRM carries chips whose meaning we know, and
 * every chip's field (`leadFirstName`, `businessName`) is also an automation
 * subject field. Those templates therefore work in an automation with no
 * mapping step at all.
 *
 * `field` null means the slot is a bare Meta placeholder from a synced template.
 * Its meaning is genuinely unknown and must never be guessed from its index —
 * the customer maps it.
 */
export type TemplateSlot = {
  /** 1-based, matching Meta's `{{n}}`. */
  position: number
  /** What the customer sees for this slot: the chip token, or `{{n}}`. */
  label: string
  /** The subject field that fills it, when known from the template itself. */
  field: string | null
}

/**
 * The slots a template exposes, in the order Meta numbers them.
 *
 * Chip order MUST mirror `buildComponents` — first appearance in the body —
 * because that is the order the approved template's `{{n}}` were generated in.
 * Any other order silently shifts every parameter by one.
 */
export function templateSlots(template: TemplateShape): TemplateSlot[] {
  const body = template.bodyText ?? ''
  const chips = (template.variables ?? []).filter((v) => body.includes(v.token))
  if (chips.length > 0) {
    return chips
      .sort((a, b) => body.indexOf(a.token) - body.indexOf(b.token))
      .map((v, i) => ({ position: i + 1, label: v.token, field: FIELD_BY_TOKEN[v.token] ?? null }))
  }
  const arity = bodyParameterCount(body)
  return Array.from({ length: arity }, (_, i) => ({ position: i + 1, label: `{{${i + 1}}}`, field: null }))
}

/** Slots the customer must map before this template can be used in an automation. */
export function unmappedSlots(template: TemplateShape, bindings: Record<string, string> = {}): TemplateSlot[] {
  return templateSlots(template).filter((s) => !(s.field ?? bindings[String(s.position)]))
}

/**
 * Meta rejects a parameter containing a newline, a tab, or a run of four or more
 * spaces, and rejects an empty one outright.
 *
 * This is not defensive: `meetingDetails` is deliberately multi-line (title,
 * time, place, link joined by "\n"), so passing a subject value through
 * untouched WOULD be rejected. Collapsing to single spaces keeps every word the
 * lead needs while satisfying the format — and the collapsed value is also what
 * gets persisted to the conversation, so the thread shows exactly what was sent.
 */
export function sanitizeParam(value: unknown): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** A guaranteed non-empty value — Meta refuses empty parameters. */
function valueFor(field: string, subject: Record<string, unknown>): string {
  const clean = sanitizeParam(subject[field])
  if (clean) return clean
  return TEMPLATE_VALUE_FALLBACK[field] ?? 'שלום'
}

export type ResolvedTemplateMessage =
  | { ok: true; params: string[]; text: string }
  | { ok: false; reason: 'unmapped'; positions: number[] }

/**
 * Resolve the positional parameters AND the human-readable text for one send.
 *
 * The text is built from the SAME values sent to Meta, so the message persisted
 * to the conversation is what the lead actually received — not a second
 * rendering that could disagree with it.
 */
export function resolveTemplateMessage(
  template: TemplateShape,
  bindings: Record<string, string>,
  subject: Record<string, unknown>,
  allowedFields: readonly string[],
): ResolvedTemplateMessage {
  const slots = templateSlots(template)
  const allowed = new Set(allowedFields)

  const missing: number[] = []
  const resolved: { slot: TemplateSlot; value: string }[] = []

  for (const slot of slots) {
    // The template's own meaning wins; the automation's binding fills the rest.
    const field = slot.field ?? bindings[String(slot.position)] ?? null
    // An unknown field is as unusable as an absent one — never resolved blindly.
    if (!field || !allowed.has(field)) {
      missing.push(slot.position)
      continue
    }
    resolved.push({ slot, value: valueFor(field, subject) })
  }

  if (missing.length > 0) return { ok: false, reason: 'unmapped', positions: missing }

  let text = template.bodyText ?? ''
  for (const { slot, value } of resolved) {
    // Chip templates carry the token in the body; synced ones carry `{{n}}`.
    text = slot.field && slot.label !== `{{${slot.position}}}` ? text.split(slot.label).join(value) : text
  }
  // Positional bodies (and any chip left over) resolve by index.
  text = text.replace(/\{\{\s*(\d+)\s*\}\}/g, (m, n) => resolved[Number(n) - 1]?.value ?? m)

  return { ok: true, params: resolved.map((r) => r.value), text: text.trim() }
}
