import type { DefinitionContent } from '@/db/automations/definitions'
import { isValidTiming, type Timing } from '@/lib/automations/timing'
import { unknownTokensFor } from '@/lib/automations/variables'
import { resolvableFieldsFor } from '@/lib/automations/executors/registry'
import { getAction, getEvent, listActionsForEvent } from '@/lib/automations/catalog/registry'
import { checkParameter } from '@/lib/automations/catalog/parameterRules'
import { engineTriggerForEventKey } from '@/lib/automations/catalog/engineBridge'
import { validateConditions, type Condition } from '@/lib/automations/conditions'

/**
 * The Builder's payload: its SHAPE, its VALIDATION, and its projection onto the
 * stored content document.
 *
 * Extracted from `actions/automations/manage.ts` when this phase pushed that
 * file past the 350-line hard limit (architecture-rules §1/§8 — the touch is
 * the trigger). The seam is real rather than arbitrary: everything here is
 * PURE — no session, no database, no revalidation — while what remains in
 * `manage.ts` is exactly the four authenticated actions plus the one check that
 * needs a read. That split is also why this file is directly testable.
 *
 * Nothing here names an action. Which content an action requires is read from
 * its own catalog declaration, which is what lets a new action be validated
 * without a line being added below.
 */

export type AutomationInput = {
  name: string
  recipeKey: string | null
  /** A CATALOG event key. The Builder no longer speaks the engine's vocabulary. */
  eventKey: string
  conditions: Condition[]
  connectionId?: string | null
  parameters?: Record<string, string>
  /**
   * WHICH action to run — an explicit CATALOG key now that more than one action
   * can serve the same event.
   *
   * Optional, and validated against what the chosen event can actually offer. Left
   * absent it falls back to the first offerable action, which is what every caller
   * did implicitly when `email.send` was the only choice — so existing callers and
   * stored recipes keep their behaviour exactly.
   */
  actionKey?: string | null
  subject: string
  body: string
  /** The optional CTA action block — both halves, or neither. */
  ctaLabel?: string | null
  ctaUrl?: string | null
  /** `whatsapp.send`'s authored surface: the chosen template and its slot mapping. */
  templateId?: number | null
  templateBindings?: Record<string, string> | null
  /** `task.create`'s authored surface: the title the rep will read. */
  title?: string | null
  /** Answers to the action's own catalog-declared parameters, keyed by key. */
  actionParameters?: Record<string, string> | null
  timing: Timing
}

export function validate(input: AutomationInput): string | null {
  if (!input.name?.trim()) return 'name_required'
  // Unknown event ⇒ inert, never guessed (Law 3).
  const event = getEvent(input.eventKey)
  if (!event || !engineTriggerForEventKey(input.eventKey)) return 'trigger_invalid'
  const conditionIssue = validateConditions(event, input.conditions ?? [])
  if (conditionIssue) return conditionIssue
  if (!isValidTiming(input.timing)) return 'timing_invalid'

  /**
   * The action is resolved BEFORE its content is judged, because what counts as
   * valid content is the action's own business. Subject and body are `email.send`'s
   * required parameters, not the engine's — demanding them from a message action
   * would reject a perfectly configured WhatsApp automation for lacking fields it
   * does not have.
   */
  const actionKey = actionKeyForInput(input)
  if (!actionKey) return 'action_invalid'

  /**
   * Catalog-declared parameters are validated from their OWN declaration —
   * required-ness and bounds come from the entry, so a new parameter is
   * enforced without a line here. Runs before the per-shape branches below
   * because it applies to whatever the action declares, not to one shape.
   */
  const declaredIssue = validateDeclaredParameters(actionKey, input.actionParameters ?? {})
  if (declaredIssue) return declaredIssue

  if (isTemplateAction(actionKey)) {
    // The content IS the approved template; there is nothing authored to lint.
    // Its existence, approval and slot mapping need a read, so they are checked
    // in `validateTemplateChoice` rather than here.
    if (!input.templateId) return 'template_required'
    return null
  }

  /**
   * A title-shaped action authors ONE line and no body. Demanding an email
   * subject and body from it would reject a perfectly configured task
   * automation for lacking fields it does not declare — the same reasoning the
   * template branch above already applies, and the reason the action is
   * resolved before its content is judged.
   */
  if (isTitleAction(actionKey)) {
    const title = input.title?.trim() ?? ''
    if (!title) return 'title_required'
    // Bounds come from the catalog declaration, so the Builder and the server
    // enforce one rule (the `validateCta` precedent).
    if (checkParameter(actionKey, 'title', title)) return 'title_invalid'
    if (unknownTokensFor(resolvableFieldsFor(actionKey), title).length) return 'unknown_variable'
    return null
  }

  /**
   * An action whose configuration is ENTIRELY catalog-declared parameters has
   * nothing else to author — no subject, no body, no CTA. Demanding email
   * content from it would reject a perfectly configured automation for lacking
   * fields it does not declare, which is the same reasoning the two branches
   * above already apply. Decided by TYPE, so no action is named.
   */
  if (declaredGenericParameters(actionKey).length > 0) return null

  if (!input.subject?.trim()) return 'subject_required'
  if (!input.body?.trim()) return 'body_required'
  /**
   * B6b: content is validated against what THIS action's executor can
   * substitute, not against a global email vocabulary. An action with no
   * executor resolves nothing, so its content is rejected rather than passed
   * by a set that never applied to it.
   */
  const resolvable = resolvableFieldsFor(actionKey)
  if (unknownTokensFor(resolvable, input.subject).length || unknownTokensFor(resolvable, input.body).length) {
    return 'unknown_variable'
  }
  const ctaIssue = validateCta(input, actionKey, resolvable)
  if (ctaIssue) return ctaIssue
  return null
}

/**
 * The CTA is ONE optional block, so it is validated as one: present means both
 * halves, absent means neither. A label with no destination is the failure mode
 * this prevents.
 */
function validateCta(input: AutomationInput, actionKey: string, resolvable: readonly string[]): string | null {
  const label = input.ctaLabel?.trim() ?? ''
  const url = input.ctaUrl?.trim() ?? ''
  if (!label && !url) return null
  if (!label || !url) return 'cta_incomplete'
  // Bounds and URL shape come from the catalog declaration, so there is one
  // source of truth for what the Builder shows and what the server enforces.
  if (checkParameter(actionKey, 'ctaLabel', label)) return 'cta_label_invalid'
  if (checkParameter(actionKey, 'ctaUrl', url)) return 'cta_url_invalid'
  if (unknownTokensFor(resolvable, label).length) return 'unknown_variable'
  return null
}

export function toContent(input: AutomationInput): Omit<DefinitionContent, 'schemaVersion'> {
  const label = input.ctaLabel?.trim() ?? ''
  const url = input.ctaUrl?.trim() ?? ''
  const hasCta = Boolean(label && url)
  return {
    subject: (input.subject ?? '').trim(),
    body: (input.body ?? '').trim(),
    timing: input.timing,
    ctaLabel: hasCta ? label : null,
    ctaUrl: hasCta ? url : null,
    // Carried only when chosen, so an email automation's content document is
    // unchanged from what it was before the messaging action existed.
    templateId: input.templateId ?? null,
    templateBindings: input.templateBindings ?? null,
    title: input.title?.trim() || null,
    // Only the parameters the chosen action actually declares are stored, so a
    // stale answer from a previously-selected action cannot ride along.
    actionParameters: pickDeclaredParameters(input),
  }
}

function pickDeclaredParameters(input: AutomationInput): Record<string, string> | null {
  const actionKey = actionKeyForInput(input)
  return actionKey ? declaredParameterAnswers(actionKey, input.actionParameters ?? {}) : null
}

/**
 * Keep only the answers the action actually declares.
 *
 * Shared with the template installer so a marketplace install and a Builder save
 * store the same shape — and so a stale answer from a previously-selected action
 * can never ride along into either.
 */
export function declaredParameterAnswers(
  actionKey: string,
  answers: Record<string, string>,
): Record<string, string> | null {
  const kept: Record<string, string> = {}
  for (const p of declaredGenericParameters(actionKey)) {
    const value = answers[p.key]
    if (typeof value === 'string' && value.trim()) kept[p.key] = value.trim()
  }
  return Object.keys(kept).length > 0 ? kept : null
}

/**
 * Which action this automation runs.
 *
 * The customer's explicit choice when they made one, and the first offerable
 * action when they did not. Either way the answer must be an action the EVENT can
 * offer — a key the caller invented, or one whose recipient this event cannot
 * supply, is refused rather than trusted.
 */
export function actionKeyForInput(input: AutomationInput): string | null {
  const event = getEvent(input.eventKey)
  if (!event) return null
  const offerable = listActionsForEvent(event)
  const chosen = input.actionKey?.trim()
  if (chosen) return offerable.some((a) => a.key === chosen) ? chosen : null
  return offerable[0]?.key ?? null
}

/** Is this action's content authored as a message template rather than as text? */
export const isTemplateAction = (actionKey: string): boolean =>
  (getAction(actionKey)?.parameters ?? []).some((p) => p.key === 'templateId')

/**
 * Is this action authored as a single title line rather than as an email?
 *
 * Decided by the action's OWN declared parameters, exactly as `isTemplateAction`
 * is — so this names no action, and a future title-shaped action needs no edit
 * here.
 */
const isTitleAction = (actionKey: string): boolean => (getAction(actionKey)?.parameters ?? []).some((p) => p.key === 'title')

/**
 * The action's generically-rendered parameters — the ones the Builder draws
 * from catalog metadata rather than from a bespoke form.
 *
 * `enum_agency` today; the filter is by TYPE so a second generically-rendered
 * type needs no edit here. The bespoke shapes (`templateId`, `title`) are
 * excluded because their own branches already validate them.
 */
const declaredGenericParameters = (actionKey: string) =>
  (getAction(actionKey)?.parameters ?? []).filter((p) => p.type === 'enum_agency')

/** Required-ness and bounds, read from the catalog declaration. */
function validateDeclaredParameters(actionKey: string, answers: Record<string, string>): string | null {
  for (const p of declaredGenericParameters(actionKey)) {
    const issue = checkParameter(actionKey, p.key, answers[p.key] ?? '')
    if (issue) return issue === 'required' ? 'parameter_required' : 'parameter_invalid'
  }
  return null
}
