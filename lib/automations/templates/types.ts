import type { ParameterDefinition, Requirement } from '../catalog/types'
import type { Condition } from '../conditions'
import type { Timing } from '../timing'

/**
 * AUTOMATION TEMPLATES — a factory, not a runtime.
 *
 * A template produces ORDINARY automations and then has no further authority
 * over them. Nothing about an installed automation is special: the Builder
 * edits it, the engine runs it, and deleting the template would not change how
 * it behaves. That is the whole design, and everything below follows from it.
 *
 * Two consequences worth stating plainly, because they are what makes the
 * system safe rather than merely convenient:
 *
 *  · AN UPDATE NEVER TOUCHES AN INSTALLED AUTOMATION. A newer template version
 *    is an offer, not a migration. The customer owns what they installed —
 *    including every edit they made to it — so the most an update may do is
 *    tell them something newer exists and install it alongside.
 *
 *  · A TEMPLATE INVENTS NOTHING. Its automations are expressed in the same
 *    catalog vocabulary the Builder uses: a registered event key, conditions
 *    on that event's declared fields, a registered action, and timing the
 *    engine already understands. A template that names something unregistered
 *    fails validation in CI rather than at install time.
 */

/** Grouping for the marketplace. Closed, append-only, template-layer only. */
export const TEMPLATE_CATEGORIES = ['lead', 'appointment', 'form', 'internal'] as const
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number]

/**
 * One automation a template creates. The same four blanks the Builder fills:
 * when · only if · then · timing.
 */
export type TemplateAutomation = {
  /** Shown as the automation's name. May contain `[[variable]]` tokens. */
  name: string
  /** A registered CATALOG event key. */
  eventKey: string
  /** Conditions on that event's declared fields. May be empty. */
  conditions: readonly Condition[]
  /** A registered CATALOG action key. */
  actionKey: string
  /**
   * The action's parameters, keyed exactly as the action declares them.
   * Values may contain `[[variable]]` tokens, substituted at INSTALL time.
   */
  parameters: Readonly<Record<string, string>>
  timing: Timing
  /**
   * Timing the CUSTOMER chooses at install, rather than a fixed offset.
   *
   * `variableKey` names an `enum_static` template variable whose values are
   * offsets in `<n><h|d>` form (`'1h'`, `'1d'`); `anchorField` names the event's
   * `datetime` field to count back from. `timing` above is the fallback used
   * when the value is unusable, so a template always has valid timing.
   *
   * This exists because `timing` alone cannot carry a token: it is a typed
   * object, not a string, so `[[substitution]]` cannot reach it. Without this a
   * template can DECLARE a timing choice and silently discard it — which is
   * exactly what `website_lead_follow_up`'s `delayDays` variable does today.
   */
  timingFromVariable?: { variableKey: string; anchorField: string }
}

/**
 * Something the customer fills in before installing.
 *
 * Deliberately the catalog's own `ParameterDefinition` — the same closed type
 * set, the same declarative validation. A template may not invent an input
 * kind any more than an integration may (Law 4).
 */
export type TemplateVariable = ParameterDefinition & { default?: string }

export type TemplateDefinition = {
  /** Stable id, referenced by install records. Append-only forever. */
  key: string
  /**
   * Bumped whenever the template's automations change. Install records keep
   * the version they were created from, which is the entire update mechanism.
   */
  version: number
  title: string
  category: TemplateCategory
  description: string
  icon: string
  /** Same typed shape as an event's. Unmet ⇒ the card is locked with its CTA. */
  requirements: readonly Requirement[]
  variables: readonly TemplateVariable[]
  automations: readonly TemplateAutomation[]
  /** What changed, per version. Shown when an update is available. */
  changelog?: readonly { version: number; note: string }[]
}

/** `[[key]]` — deliberately NOT `{{token}}`, which is the RUNTIME variable
 *  syntax the renderer substitutes per lead. Template variables are resolved
 *  once, at install, and must never be confused with the ones that survive
 *  into the saved automation. */
export const TEMPLATE_TOKEN = /\[\[([a-zA-Z0-9_]+)\]\]/g
