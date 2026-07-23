/**
 * Friendly form ⇄ Meta component array, and Meta template-name generation.
 *
 * Pure. The owner types a human title + a body with friendly variable chips; Meta
 * needs a machine `name` (^[a-z0-9_]+$) and positional `{{n}}` params with example
 * values. This module is the only place that translation happens.
 */
import type { MetaComponent, TemplateVariable } from './types'

/**
 * Derive a Meta template name from the owner's title. Meta names allow only
 * `[a-z0-9_]`, so a Hebrew title yields the neutral base `ready_message` (no PII —
 * RFC §9). Uniquified against `existingNames` with a numeric suffix.
 */
export function slugifyTemplateName(displayTitle: string, existingNames: readonly string[] = []): string {
  const base =
    (displayTitle ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 60) || 'ready_message'
  let name = base
  let n = 2
  while (existingNames.includes(name)) name = `${base}_${n++}`
  return name
}

/**
 * Build the Meta component array from the body text and the friendly variables.
 *
 * Only variables that actually appear in the body get a positional placeholder,
 * ordered by first appearance — so the `{{n}}` count always matches the `example`
 * count (a mismatch is a top cause of Meta rejection). Every occurrence of a token
 * maps to the same placeholder.
 */
export function buildComponents(bodyText: string, variables: TemplateVariable[]): MetaComponent[] {
  const body = bodyText ?? ''
  const present = (variables ?? [])
    .filter((v) => body.includes(v.token))
    .sort((a, b) => body.indexOf(a.token) - body.indexOf(b.token))

  let text = body
  present.forEach((v, i) => {
    text = text.split(v.token).join(`{{${i + 1}}}`)
  })

  const component: MetaComponent = { type: 'BODY', text }
  if (present.length > 0) {
    component.example = { body_text: [present.map((v) => v.sample)] }
  }
  return [component]
}

/**
 * Every Meta-style placeholder (`{{1}}`, `{{lead_name}}`, …) in a piece of text.
 * Our authoring system never uses braces — it uses the picker chips (e.g.
 * `שם הליד`) — so any match in a *submitted* body is a manual bypass.
 */
export function bodyPlaceholders(text: string): string[] {
  return (text ?? '').match(/\{\{[^}]*\}\}/g) ?? []
}

/**
 * Defense-in-depth for the Meta contract: true if any BODY carries more
 * placeholders than it has example values — i.e. a parameter Meta rejects for a
 * missing example (`INVALID_FORMAT`). `buildComponents` pairs every positional
 * `{{n}}` with exactly one example, so this is only ever true when a raw `{{...}}`
 * slipped through un-converted. Guarantees a payload with BODY placeholders can
 * never be assembled without matching BODY examples.
 */
export function hasUnexampledParameters(components: MetaComponent[]): boolean {
  for (const c of components) {
    const placeholders = bodyPlaceholders(c.text ?? '').length
    const examples = c.example?.body_text?.[0]?.length ?? 0
    if (placeholders > examples) return true
  }
  return false
}
