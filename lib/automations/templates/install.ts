import { getAction, getEvent, listActionsForEvent } from '../catalog/registry'
import { validateConditions } from '../conditions'
import { isValidTiming } from '../timing'
import { TEMPLATE_TOKEN, type TemplateAutomation, type TemplateDefinition } from './types'

/**
 * Turning a template into automation inputs — pure, and the only place
 * substitution happens.
 *
 * Nothing here writes: it produces exactly what the customer would have typed
 * into the Builder, which is what "templates install ordinary automations"
 * means in practice. The action that persists them uses the same store the
 * Builder uses, so an installed automation is indistinguishable from a
 * hand-built one the moment it exists.
 */

export type TemplateValues = Record<string, string>

/** Defaults, overridden by whatever the customer supplied. */
export function resolveValues(template: TemplateDefinition, supplied: TemplateValues = {}): TemplateValues {
  const out: TemplateValues = {}
  for (const variable of template.variables) {
    const given = supplied[variable.key]
    out[variable.key] = (given ?? variable.default ?? '').trim()
  }
  return out
}

/**
 * `[[key]]` → the customer's value. An unknown token resolves to empty rather
 * than being left visible: a raw `[[thing]]` in a real customer email is worse
 * than a gap, and validation has already rejected templates that contain one.
 */
export function substitute(text: string, values: TemplateValues): string {
  return text.replace(TEMPLATE_TOKEN, (_, key: string) => values[key] ?? '')
}

export type PreparedAutomation = {
  name: string
  eventKey: string
  conditions: TemplateAutomation['conditions']
  actionKey: string
  parameters: Record<string, string>
  timing: TemplateAutomation['timing']
}

export function prepare(template: TemplateDefinition, supplied: TemplateValues = {}): PreparedAutomation[] {
  const values = resolveValues(template, supplied)
  return template.automations.map((a) => ({
    name: substitute(a.name, values),
    eventKey: a.eventKey,
    conditions: a.conditions,
    actionKey: a.actionKey,
    parameters: Object.fromEntries(
      Object.entries(a.parameters).map(([key, value]) => [key, substitute(value, values)]),
    ),
    timing: a.timing,
  }))
}

/**
 * Everything that must be true for a template to be installable, checked
 * against the live catalog rather than trusted.
 *
 * Run in CI over every registered template, so a template referencing an event
 * that was never registered — or an action that event cannot offer — fails the
 * build instead of failing in a customer's account.
 */
export function validateTemplate(template: TemplateDefinition): string[] {
  const issues: string[] = []
  const at = `template:${template.key}`

  if (!/^[a-z0-9_]+$/.test(template.key)) issues.push(`${at}: key must be lowercase snake_case`)
  if (!Number.isInteger(template.version) || template.version < 1) issues.push(`${at}: version must be a positive integer`)
  if (!template.title.trim()) issues.push(`${at}: title is required`)
  if (!template.description.trim()) issues.push(`${at}: description is required`)
  if (template.automations.length === 0) issues.push(`${at}: a template with no automations installs nothing`)

  const declared = new Set(template.variables.map((v) => v.key))
  for (const variable of template.variables) {
    if (!/^[a-zA-Z0-9_]+$/.test(variable.key)) issues.push(`${at}: variable "${variable.key}" is not a valid token`)
  }

  template.automations.forEach((automation, i) => {
    const where = `${at}.automations[${i}]`
    const event = getEvent(automation.eventKey)
    if (!event) {
      issues.push(`${where}: unknown event "${automation.eventKey}"`)
      return
    }

    const action = getAction(automation.actionKey)
    if (!action) {
      issues.push(`${where}: unknown action "${automation.actionKey}"`)
      return
    }
    // `requires` × the event's fields — the same rule the Builder applies, so
    // a template can never offer a combination the Builder would refuse.
    if (!listActionsForEvent(event).some((a) => a.key === action.key)) {
      issues.push(`${where}: action "${action.key}" is not offerable for event "${event.key}"`)
    }

    const conditionIssue = validateConditions(event, automation.conditions)
    if (conditionIssue) issues.push(`${where}: ${conditionIssue}`)

    if (!isValidTiming(automation.timing)) issues.push(`${where}: invalid timing`)

    for (const parameter of action.parameters) {
      const value = automation.parameters[parameter.key]
      if (parameter.validation?.required && !String(value ?? '').trim()) {
        issues.push(`${where}: required parameter "${parameter.key}" is empty`)
      }
    }

    // Every token must resolve, in the name and in every parameter.
    const texts = [automation.name, ...Object.values(automation.parameters)]
    for (const text of texts) {
      for (const match of text.matchAll(TEMPLATE_TOKEN)) {
        if (!declared.has(match[1])) issues.push(`${where}: undeclared variable "[[${match[1]}]]"`)
      }
    }
  })

  return issues
}
