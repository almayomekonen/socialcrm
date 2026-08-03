import { TEMPLATE_ENTRIES } from './entries'
import { validateTemplate } from './install'
import type { TemplateDefinition } from './types'

/**
 * The marketplace, as data. Adding a template is one entry in `entries.ts`.
 *
 * No lookup by anything but the key, and no ordering logic: the marketplace
 * shows what is registered, grouped by the category each template declares.
 */
export const templates: readonly TemplateDefinition[] = TEMPLATE_ENTRIES

export function listTemplates(): readonly TemplateDefinition[] {
  return templates
}

/** Unknown key ⇒ null. The caller refuses rather than guessing (Law 3). */
export function getTemplate(key: string): TemplateDefinition | null {
  return templates.find((t) => t.key === key) ?? null
}

/** Every issue across the whole marketplace. CI asserts this is empty. */
export function validateMarketplace(): string[] {
  const issues = templates.flatMap(validateTemplate)
  const seen = new Set<string>()
  for (const t of templates) {
    if (seen.has(t.key)) issues.push(`template:${t.key}: duplicate key`)
    seen.add(t.key)
  }
  return issues
}
